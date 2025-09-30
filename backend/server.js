const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('./db'); // This is your existing pg pool from db.js
const multer = require('multer');
const cors = require('cors'); // Import the cors middleware

// Import Contest routes and scheduler
const contestRoutes = require('./routes/contests');
const contestScheduler = require('./services/contestScheduler');
const { requireAuth, requireStaffOrAdmin } = require('./middleware/auth');
const unzipper = require('unzipper');
const { processBatchUpload } = require('./services/batchUploadService'); // Import the new service

const progressMap = new Map(); // Store SSE response objects by a unique upload ID

// Multer configuration for single file uploads (in memory)
const memoryUpload = multer({ storage: multer.memoryStorage() });

// Multer configuration for batch uploads (to disk)
const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    // We'll use a temporary directory provided by the OS
    const uploadPath = path.join('/tmp', 'oj_uploads');
    fs.mkdirSync(uploadPath, { recursive: true }); // Ensure the dir exists
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Create a unique filename to avoid conflicts
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const diskUpload = multer({ storage: diskStorage });


const app = express();
app.set('trust proxy', 1); // Trust the reverse proxy for secure cookies
const port = process.env.PORT;

app.use(express.json());

// Configure CORS using the cors middleware
app.use(cors({
  origin: 'https://www.woi-grader.com',
  // credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie'],
}));

// PostgreSQL session store setup
app.use(session({
  store: new pgSession({
    pool: db.pool, // Use the existing pg pool from db.js
    tableName: 'user_sessions', // Name of the table to store sessions
  }),
  secret: process.env.SECRET_KEY, // Use environment variable
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, // Set to true for production
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Use Contest routes (after session middleware)
app.use('/contests', contestRoutes);
app.use('/admin/contests', contestRoutes);

// Middleware to check if user is an admin
const requireAdmin = (req, res, next) => {
  if (req.session.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};

async function runSingleCase(executablePath, input, timeLimitMs, memoryLimitMb) {
  return new Promise((resolve) => {
    // The command for the Linux environment inside Docker
    const timeCommand = `/usr/bin/time -f "TIME_USED:%e MEM_USED:%M"`;
    
    // Use timeout command which is reliable on Linux
    const command = `timeout ${timeLimitMs / 1000}s ${timeCommand} ${executablePath}`;
    const executionOptions = { 
      timeout: timeLimitMs + 500, // 
      maxBuffer: 50 * 1024 * 1024, // 50MB
      shell: '/bin/bash'
    };

    let hasEpipError = false;
    let epipErrorMessage = '';

    const child = exec(command, executionOptions, (error, stdout, stderr) => {
      let timeMs = -1;
      let memoryKb = -1;
      let programOutput = stdout;
      let programStderr = stderr;

      if (stderr) {
        const timeRegex = /TIME_USED:([0-9.]+)/;
        const memRegex = /MEM_USED:(\d+)/;
        const timeMatch = stderr.match(timeRegex);
        const memMatch = stderr.match(memRegex);
        if (timeMatch) timeMs = Math.round(parseFloat(timeMatch[1]) * 1000);
        if (memMatch) memoryKb = parseInt(memMatch[1], 10);
        
        // Clean stderr for reporting
        programStderr = stderr.split('\n').filter(line => !line.includes('MEM_USED') && !line.includes('TIME_USED')).join('\n').trim();
      }

      // If we had an EPIPE error, prioritize it over other errors
      if (hasEpipError) {
        return resolve({ 
          status: 'Runtime Error', 
          output: epipErrorMessage || 'Program crashed while receiving input (EPIPE)', 
          timeMs, 
          memoryKb 
        });
      }

      if (error) {
        // Did it time out? 'timeout' command exits with 124
        if (error.code === 124) { 
          return resolve({ status: 'Time Limit Exceeded', timeMs: timeLimitMs, memoryKb });
        }
        // Did it run out of memory? SIGSEGV is a common indicator.
        if (error.signal === 'SIGSEGV' || stderr.toLowerCase().includes('memory')) {
          return resolve({ status: 'Memory Limit Exceeded', timeMs, memoryKb: memoryLimitMb * 1024 });
        }
        // For other errors, treat as Runtime Error
        return resolve({ 
          status: 'Runtime Error', 
          output: programStderr || error.message || 'Program terminated unexpectedly', 
          timeMs, 
          memoryKb 
        });
      }
      
      resolve({ status: 'Pending', output: programOutput, timeMs, memoryKb });
    });

    // Prevent EPIPE errors from crashing the main process.
    // These can happen if the child process exits or crashes before stdin is fully written.
    child.stdin.on('error', (err) => {
      if (err.code === 'EPIPE') {
        hasEpipError = true;
        epipErrorMessage = `Program crashed while receiving input: ${err.message}`;
        console.warn(`Caught EPIPE on stdin for executable ${executablePath}. Error: ${err.message}`);
      }
    });

    // Also catch errors on the child process itself
    child.on('error', (err) => {
      console.warn(`Child process error for ${executablePath}:`, err);
      if (!hasEpipError) {
        hasEpipError = true;
        epipErrorMessage = `Process error: ${err.message}`;
      }
    });

    // Handle process exit with non-zero code
    child.on('exit', (code, signal) => {
      if (code !== 0 && signal !== null && !hasEpipError) {
        hasEpipError = true;
        epipErrorMessage = `Process exited with code ${code} and signal ${signal}`;
      }
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

async function judge(problemId, executablePath) {
  try {
    const problemRes = await db.query('SELECT time_limit_ms, memory_limit_mb FROM problems WHERE id = $1', [problemId]);
    if (problemRes.rows.length === 0) {
      return { overallStatus: "System Error", score: 0, results: [] };
    }
    const { time_limit_ms, memory_limit_mb } = problemRes.rows[0];

    const testcasesRes = await db.query('SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 ORDER BY case_number ASC', [problemId]);
    const testcases = testcasesRes.rows;

    if (testcases.length === 0) {
      return { overallStatus: "System Error", score: 0, results: [{ testCase: 1, status: 'No test cases found' }] };
    }

    const results = [];
    for (const testcase of testcases) {
      const { case_number, input_data, output_data } = testcase;

      const runResult = await runSingleCase(executablePath, input_data, time_limit_ms, memory_limit_mb);
      
      // Now, compare output
      if (runResult.status === 'Pending') {
        const formattedStdout = runResult.output.trim().replace(/\r\n/g, '\n');
        const formattedExpectedOutput = output_data.trim().replace(/\r\n/g, '\n');
        if (formattedStdout === formattedExpectedOutput) {
          runResult.status = 'Accepted';
        } else {
          runResult.status = 'Wrong Answer';
        }
      }
      
      results.push({
        testCase: case_number,
        status: runResult.status,
        timeMs: runResult.timeMs,
        memoryKb: runResult.memoryKb,
        output: runResult.status !== 'Accepted' && runResult.status !== 'Wrong Answer' ? runResult.output : undefined,
      });
      
      // Stop on first non-Accepted result for immediate feedback
      if (runResult.status !== 'Accepted') {
        // To show all results, comment out the loop break.
        // For now, let's fill the rest with 'Skipped' to show the user there are more.
        for (let j = testcases.findIndex(t => t.case_number === case_number) + 1; j < testcases.length; j++) {
            results.push({ testCase: testcases[j].case_number, status: 'Skipped' });
        }
        break; 
      }
    }

    const passedCases = results.filter(r => r.status === 'Accepted').length;
    const totalCases = testcases.length;
    const score = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
    const firstFailed = results.find(r => r.status !== 'Accepted');
    const overallStatus = firstFailed ? firstFailed.status : 'Accepted';
    const maxTime = Math.max(0, ...results.map(r => r.timeMs || 0));
    const maxMemory = Math.max(0, ...results.map(r => r.memoryKb || 0));

    return { results, score, overallStatus, maxTimeMs: maxTime, maxMemoryKb: maxMemory };

  } catch (error) {
    console.error("Error during judging:", error);
    return { overallStatus: "System Error", score: 0, results: [{ testCase: 1, status: 'Could not read test cases' }] };
  }
}

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.post('/register', [
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    // Check if registration is enabled
    const regSettings = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'"
    );
    if (regSettings.rows.length === 0 || regSettings.rows[0].setting_value !== 'true') {
      return res.status(403).json({ message: 'Registration is currently disabled.' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      // Check if username already exists
      const existingUser = await db.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({ message: 'Username already exists' });
      }

      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Insert new user
      const result = await db.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username, hashedPassword]
      );

      res.status(201).json({
        message: 'User registered successfully',
        user: result.rows[0]
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  } catch (error) {
    res.status(403).json({ message: 'Registration is currently disabled.' });
  }
});

// PUBLIC facing endpoint to check registration status
app.get('/settings/registration', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'"
    );

    if (result.rows.length === 0) {
      return res.json({ enabled: false });
    }
    res.json({ enabled: result.rows[0].setting_value === 'true' });
  } catch (error) {
    // On error, default to disabled for security.
    console.error('Error fetching public registration setting:', error);
    res.json({ enabled: false });
  }
});


app.post('/login', [
  body('username').trim().escape(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, password } = req.body;

  try {
    // Find user by username
    const result = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Create session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role; // Use role instead of isAdmin

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role, // Send role to frontend
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Error logging out' });
    }
    res.json({ message: 'Logout successful' });
  });
});

app.get('/me', (req, res) => {
  if (req.session.userId) {
    res.json({
      isAuthenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role, // Use role
      }
    });
  } else {
    res.json({ isAuthenticated: false });
  }
});

app.post('/submit', requireAuth, memoryUpload.none(), async (req, res) => {
  const { problemId, language, code, contestId } = req.body;
  const { userId } = req.session;

  if (language !== 'cpp') {
    return res.status(400).json({ message: 'Only C++ is supported.' });
  }
  if (!problemId || !code) {
    return res.status(400).json({ message: 'Problem ID and code are required.' });
  }

  try {
    // Check if this is a contest submission
    if (contestId) {
      // Validate contest exists and is running
      const contestRes = await db.query(
        'SELECT id, status, start_time, end_time FROM contests WHERE id = $1',
        [contestId]
      );
      
      if (contestRes.rows.length === 0) {
        return res.status(404).json({ message: 'Contest not found.' });
      }
      
      const contest = contestRes.rows[0];
      if (contest.status !== 'running') {
        return res.status(400).json({ 
          message: `Contest is not running. Current status: ${contest.status}` 
        });
      }
      
      // Check if user is a participant
      const participantRes = await db.query(
        'SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [contestId, userId]
      );
      
      if (participantRes.rows.length === 0) {
        return res.status(403).json({ 
          message: 'You must join the contest before submitting.' 
        });
      }
      
      // Check if problem belongs to this contest
      const problemRes = await db.query(
        'SELECT 1 FROM problems WHERE id = $1 AND contest_id = $2',
        [problemId, contestId]
      );
      
      if (problemRes.rows.length === 0) {
        return res.status(400).json({ 
          message: 'Problem does not belong to this contest.' 
        });
      }
      
      // Create contest submission
      const submissionRes = await db.query(
        `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score)
         VALUES ($1, $2, $3, $4, $5, 'Pending', 0) RETURNING id`,
        [contestId, userId, problemId, code, language]
      );
      const submissionId = submissionRes.rows[0].id;

      res.status(202).json({
        message: 'Contest submission received and is being processed.',
        submissionId: submissionId,
        isContestSubmission: true
      });

      // Fire-and-forget background processing for contest submission
      processContestSubmission(submissionId);
      
    } else {
      // Regular submission to main system
      // Check if problem is available (not in any contest and visible)
      const problemRes = await db.query(
        'SELECT 1 FROM problems WHERE id = $1 AND is_visible = true AND contest_id IS NULL',
        [problemId]
      );
      
      if (problemRes.rows.length === 0) {
        return res.status(400).json({ 
          message: 'Problem is not available for submission.' 
        });
      }
      
      const submissionRes = await db.query(
        `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
         VALUES ($1, $2, $3, $4, 'Pending', 0) RETURNING id`,
        [userId, problemId, code, language]
      );
      const submissionId = submissionRes.rows[0].id;

      res.status(202).json({
        message: 'Submission received and is being processed.',
        submissionId: submissionId,
        isContestSubmission: false
      });

      // Fire-and-forget background processing
      processSubmission(submissionId);
    }

  } catch (dbError) {
    console.error("Error creating initial submission:", dbError);
    res.status(500).json({ message: "Failed to queue submission." });
  }
});

async function processSubmission(submissionId) {
  let filePath = '';
  let outputPath = '';

  try {
    const subRes = await db.query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
    if (subRes.rows.length === 0) {
      console.error(`Submission ${submissionId} not found for processing.`);
      return;
    }
    const { problem_id, code } = subRes.rows[0];

    await db.query(`UPDATE submissions SET overall_status = 'Compiling' WHERE id = $1`, [submissionId]);

    const uniqueId = `${submissionId}_${Date.now()}`;
    filePath = path.join(__dirname, 'submissions', `${uniqueId}.cpp`);
    outputPath = path.join(__dirname, 'submissions', `${uniqueId}.out`);
    const submissionsDir = path.join(__dirname, 'submissions');

    if (!fs.existsSync(submissionsDir)) {
      fs.mkdirSync(submissionsDir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, code);

    // Use UndefinedBehaviorSanitizer to reliably catch signed integer overflow as a runtime error.
    const compileCommand = `g++ -std=c++20 -fsanitize=signed-integer-overflow ${filePath} -o ${outputPath}`;
    try {
      await execPromise(compileCommand);
    } catch (compileError) {
      console.error(`Compilation error for submission ${submissionId}:`, compileError.stderr);
      await db.query(
        `UPDATE submissions SET overall_status = 'Compilation Error', results = $1 WHERE id = $2`,
        [JSON.stringify([{ status: 'Compilation Error', output: compileError.stderr }]), submissionId]
      );
      return; 
    } finally {
      fs.unlink(filePath, (err) => { if (err) console.error(`Error deleting .cpp file for sub ${submissionId}:`, err); });
    }

    await db.query(`UPDATE submissions SET overall_status = 'Running' WHERE id = $1`, [submissionId]);
    await fs.promises.chmod(outputPath, 0o755);
    const judgeResult = await judge(problem_id, outputPath);

    const { results, score, overallStatus, maxTimeMs, maxMemoryKb } = judgeResult;
    await db.query(
      `UPDATE submissions
       SET overall_status = $1, score = $2, results = $3, max_time_ms = $4, max_memory_kb = $5
       WHERE id = $6`,
      [overallStatus, score, JSON.stringify(results), maxTimeMs, maxMemoryKb, submissionId]
    );

  } catch (error) {
    console.error(`Critical error processing submission ${submissionId}:`, error);
    try {
      await db.query(
        `UPDATE submissions SET overall_status = 'System Error' WHERE id = $1`,
        [submissionId]
      );
    } catch (dbError) {
      console.error(`Failed to update submission ${submissionId} to System Error status:`, dbError);
    }
  } finally {
    fs.unlink(outputPath, (err) => { if (err) console.error(`Error deleting .out file for sub ${submissionId}:`, err); });
  }
}

// Process contest submissions (similar to processSubmission but for contest_submissions table)
async function processContestSubmission(submissionId) {
  let filePath = '';
  let outputPath = '';

  try {
    const subRes = await db.query('SELECT * FROM contest_submissions WHERE id = $1', [submissionId]);
    if (subRes.rows.length === 0) {
      console.error(`Contest submission ${submissionId} not found for processing.`);
      return;
    }
    const { problem_id, code } = subRes.rows[0];

    await db.query(`UPDATE contest_submissions SET overall_status = 'Compiling' WHERE id = $1`, [submissionId]);

    const uniqueId = `contest_${submissionId}_${Date.now()}`;
    filePath = path.join(__dirname, 'submissions', `${uniqueId}.cpp`);
    outputPath = path.join(__dirname, 'submissions', `${uniqueId}.out`);
    const submissionsDir = path.join(__dirname, 'submissions');

    if (!fs.existsSync(submissionsDir)) {
      fs.mkdirSync(submissionsDir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, code);

    // Use UndefinedBehaviorSanitizer to reliably catch signed integer overflow as a runtime error.
    const compileCommand = `g++ -std=c++20 -fsanitize=signed-integer-overflow ${filePath} -o ${outputPath}`;
    try {
      await execPromise(compileCommand);
    } catch (compileError) {
      console.error(`Compilation error for contest submission ${submissionId}:`, compileError.stderr);
      await db.query(
        `UPDATE contest_submissions SET overall_status = 'Compilation Error', results = $1 WHERE id = $2`,
        [JSON.stringify([{ status: 'Compilation Error', output: compileError.stderr }]), submissionId]
      );
      return; 
    } finally {
      fs.unlink(filePath, (err) => { if (err) console.error(`Error deleting .cpp file for contest sub ${submissionId}:`, err); });
    }

    await db.query(`UPDATE contest_submissions SET overall_status = 'Running' WHERE id = $1`, [submissionId]);
    await fs.promises.chmod(outputPath, 0o755);
    const judgeResult = await judge(problem_id, outputPath);

    const { results, score, overallStatus, maxTimeMs, maxMemoryKb } = judgeResult;
    await db.query(
      `UPDATE contest_submissions
       SET overall_status = $1, score = $2, results = $3, max_time_ms = $4, max_memory_kb = $5
       WHERE id = $6`,
      [overallStatus, score, JSON.stringify(results), maxTimeMs, maxMemoryKb, submissionId]
    );

  } catch (error) {
    console.error(`Critical error processing contest submission ${submissionId}:`, error);
    try {
      await db.query(
        `UPDATE contest_submissions SET overall_status = 'System Error' WHERE id = $1`,
        [submissionId]
      );
    } catch (dbError) {
      console.error(`Failed to update contest submission ${submissionId} to System Error status:`, dbError);
    }
  } finally {
    fs.unlink(outputPath, (err) => { if (err) console.error(`Error deleting .out file for contest sub ${submissionId}:`, err); });
  }
}

app.get('/problems-with-stats', requireAuth, async (req, res) => {
  const { userId } = req.session;
  try {
    const query = `
      WITH RankedSubmissions AS (
        SELECT
          s.id,
          s.user_id,
          s.problem_id,
          s.score,
          s.overall_status,
          s.results,
          s.submitted_at,
          -- Rank submissions by score (desc) and then by submission time (desc) to find the best
          ROW_NUMBER() OVER(PARTITION BY s.user_id, s.problem_id ORDER BY s.score DESC, s.id DESC) as rn_best,
          -- Rank submissions by time (desc) to find the latest
          ROW_NUMBER() OVER(PARTITION BY s.user_id, s.problem_id ORDER BY s.id DESC) as rn_latest
        FROM submissions s
        WHERE s.user_id = $1
      ),
      UserProblemStats AS (
        SELECT
          problem_id,
          MAX(score) AS best_score,
          COUNT(*) AS submission_count
        FROM submissions
        WHERE user_id = $1
        GROUP BY problem_id
      )
      SELECT
        p.id,
        p.title,
        p.author,
        ups.best_score,
        ups.submission_count,
        -- Latest submission details
        latest.submitted_at AS latest_submission_at,
        latest.overall_status AS latest_submission_status,
        -- Best submission details
        best.overall_status AS best_submission_status,
        best.results AS best_submission_results
      FROM problems p
      LEFT JOIN UserProblemStats ups ON p.id = ups.problem_id
      LEFT JOIN RankedSubmissions latest ON p.id = latest.problem_id AND latest.rn_latest = 1
      LEFT JOIN RankedSubmissions best ON p.id = best.problem_id AND best.rn_best = 1
      WHERE p.is_visible = true AND p.contest_id IS NULL
      ORDER BY p.id;
    `;
    const result = await db.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching problems with stats:', error);
    res.status(500).json({ message: 'Error fetching problem data' });
  }
});


// Problem API Endpoints
app.get('/problems', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, title, author FROM problems WHERE is_visible = true AND contest_id IS NULL ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching problems:', error);
    res.status(500).json({ message: 'Error fetching problems' });
  }
});

app.get('/problems/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT id, title, author, time_limit_ms, memory_limit_mb, (problem_pdf IS NOT NULL) as has_pdf, is_visible FROM problems WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Problem not found' });
    }
    
    // Allow admin/staff to view hidden problems, otherwise apply visibility check
    const isStaffOrAdmin = req.session.role === 'admin' || req.session.role === 'staff';

    if (!result.rows[0].is_visible && !isStaffOrAdmin) {
      return res.status(403).json({
        message: 'Problem is hidden',
        detail: 'This problem has been hidden by administrators and is not accessible to regular users.',
        problemId: id,
        title: result.rows[0].title || 'Hidden Problem'
      });
    }
    
    // Remove is_visible from response for regular users (admin/staff still see it)
    const { is_visible, ...problemData } = result.rows[0];
    res.json(isStaffOrAdmin ? result.rows[0] : problemData);
  } catch (error) {
    console.error(`Error fetching problem ${id}:`, error);
    res.status(500).json({ message: 'Error fetching problem details' });
  }
});

app.get('/problems/:id/pdf', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT problem_pdf FROM problems WHERE id = $1', [id]);
    if (result.rows.length === 0 || !result.rows[0].problem_pdf) {
      return res.status(404).json({ message: 'Problem PDF not found.' });
    }
    const pdfData = result.rows[0].problem_pdf;
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfData);
  } catch (error) {
    console.error(`Error fetching PDF for problem ${id}:`, error);
    res.status(500).json({ message: 'Error fetching PDF' });
  }
});

app.get('/submissions', requireAuth, async (req, res) => {
  const { filter, problemId, contestId } = req.query; // Add contestId
  const { userId } = req.session;
  
  try {
    let query, params = [], conditions = [];

    if (contestId) {
      // Fetch contest submissions
      query = `
        SELECT 
          cs.id, u.username, cs.problem_id, p.title AS problem_title,
          cs.overall_status, cs.score, cs.language, cs.submitted_at
        FROM contest_submissions cs
        JOIN users u ON cs.user_id = u.id
        JOIN problems p ON cs.problem_id = p.id
      `;
      
      params.push(contestId);
      conditions.push(`cs.contest_id = $${params.length}`);
    } else {
      // Fetch regular submissions
      query = `
        SELECT 
          s.id, u.username, s.problem_id, p.title AS problem_title,
          s.overall_status, s.score, s.language, s.submitted_at
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        JOIN problems p ON s.problem_id = p.id
      `;
    }

    if (filter === 'mine') {
      params.push(userId);
      conditions.push(`${contestId ? 'cs' : 's'}.user_id = $${params.length}`);
    }

    if (problemId) {
      params.push(problemId);
      conditions.push(`${contestId ? 'cs' : 's'}.problem_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY ${contestId ? 'cs' : 's'}.submitted_at DESC LIMIT 50;`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ message: 'Error fetching submissions' });
  }
});

app.get('/submissions/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { contestId } = req.query; // Check if this is a contest submission request
  const { userId, role } = req.session;

  try {
    let result;
    
    if (contestId) {
      // Fetch contest submission
      result = await db.query(
        `SELECT cs.*, u.username 
         FROM contest_submissions cs
         LEFT JOIN users u ON cs.user_id = u.id
         WHERE cs.id = $1 AND cs.contest_id = $2`,
        [id, contestId]
      );
    } else {
      // Fetch regular submission
      result = await db.query(
        `SELECT s.*, u.username 
         FROM submissions s
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = $1`,
        [id]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    const submission = result.rows[0];

    // Allow access if the user is an admin, a staff member, or the owner of the submission
    const isOwner = submission.user_id === userId;
    const isStaffOrAdmin = role === 'admin' || role === 'staff';

    if (!isOwner && !isStaffOrAdmin) {
      return res.status(403).json({ message: 'You are not authorized to view this submission.' });
    }

    res.json(submission);
  } catch (error) {
    console.error(`Error fetching submission ${id}:`, error);
    res.status(500).json({ message: 'Error fetching submission details' });
  }
});

app.get('/scoreboard', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      WITH UserBestScores AS (
        -- For each user and each problem, find their highest score
        SELECT
          user_id,
          problem_id,
          MAX(score) AS best_score,
          MAX(submitted_at) AS latest_score_time
        FROM submissions
        GROUP BY user_id, problem_id
      )
      -- Now, sum up the best scores for each user
      SELECT
        u.username,
        SUM(ubs.best_score) AS total_score,
        COUNT(CASE WHEN ubs.best_score = 100 THEN 1 END) AS problems_solved,
        MAX(ubs.latest_score_time) AS last_score_improvement_time
      FROM UserBestScores ubs
      JOIN users u ON ubs.user_id = u.id
      GROUP BY u.username
      ORDER BY total_score DESC, last_score_improvement_time ASC;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scoreboard:', error);
    res.status(500).json({ message: 'Error fetching scoreboard' });
  }
});


// Admin API Endpoints
// User Management
app.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, role, created_at FROM users ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

app.post('/admin/users', requireAuth, requireAdmin, [
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['user', 'staff'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, password, role } = req.body;

  try {
    const existingUser = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, role]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error('Error creating user by admin:', error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

app.put('/admin/users/:id', requireAuth, requireAdmin, [
  body('username').isLength({ min: 3 }).trim().escape(),
  body('role').isIn(['user', 'staff', 'admin']) // <-- Allow 'admin' role
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { username, role } = req.body;

  // Prevent admin from editing their own account
  if (req.session.userId == id) {
    return res.status(403).json({ message: 'Admins cannot edit their own account.' });
  }

  try {
    // Fetch the user being edited to check their username
    const userToEditRes = await db.query('SELECT username FROM users WHERE id = $1', [id]);
    if (userToEditRes.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (userToEditRes.rows[0].username === 'Nonbangkok') {
      return res.status(403).json({ message: 'The "Nonbangkok" account cannot be edited.' });
    }

    // Check if the new username is already taken by another user
    const existingUser = await db.query(
      'SELECT id FROM users WHERE username = $1 AND id != $2',
      [username, id]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    const result = await db.query(
      'UPDATE users SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role',
      [username, role, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error updating user ${id}:`, error);
    if (error.code === '23505') { // unique_violation
        return res.status(409).json({ message: 'Username is already taken.' });
    }
    res.status(500).json({ message: 'Error updating user' });
  }
});

app.delete('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  // Prevent admin from deleting their own account
  if (req.session.userId == id) {
    return res.status(403).json({ message: 'Admins cannot delete their own account.' });
  }

  try {
    // Fetch the user being deleted to check their username
    const userToDeleteRes = await db.query('SELECT username FROM users WHERE id = $1', [id]);
    if (userToDeleteRes.rows.length === 0) {
      // User already doesn't exist, so we can consider the delete successful.
      return res.status(200).json({ message: `User ${id} deleted successfully` });
    }
    if (userToDeleteRes.rows[0].username === 'Nonbangkok') {
      return res.status(403).json({ message: 'The "Nonbangkok" account cannot be deleted.' });
    }

    // We also need to handle submissions from this user.
    // For simplicity, we can just delete them. A better approach might be to anonymize them.
    await db.query('DELETE FROM submissions WHERE user_id = $1', [id]);
    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json({ message: `User ${id} deleted successfully` });
  } catch (error) {
    console.error(`Error deleting user ${id}:`, error);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

app.post('/admin/users/batch', requireAuth, requireAdmin, [
  body('prefix').isLength({ min: 1 }).trim().escape(),
  body('count').isInt({ min: 1, max: 100 }) // Limit to 100 users at a time for performance
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { prefix, count } = req.body;
  const generatedUsers = [];
  const saltRounds = 10;

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 1; i <= count; i++) {
      const username = `${prefix}-${i.toString().padStart(2, '0')}`;
      const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
      let password = '';
      for (let j = 0; j < 16; j++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
      }
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const existingUser = await client.query('SELECT id FROM users WHERE username = $1', [username]);
      if (existingUser.rows.length > 0) {
        // This username already exists, we must abort the transaction.
        // We could also choose to skip, but aborting is safer to avoid partial creations.
        await client.query('ROLLBACK');
        return res.status(409).json({ message: `Username '${username}' already exists. Aborting operation.` });
      }

      await client.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [username, hashedPassword, 'user']
      );

      generatedUsers.push({ username, password });
    }

    await client.query('COMMIT');
    res.status(201).json({ message: `${count} users created successfully.`, users: generatedUsers });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during batch user creation:', error);
    res.status(500).json({ message: 'An error occurred during batch user creation.' });
  } finally {
    client.release();
  }
});

// Problem Management
app.post('/admin/problems', requireAuth, requireStaffOrAdmin, [
    body('id').isLength({ min: 1 }).trim().escape(),
    body('title').isLength({ min: 1 }).trim(),
    body('author').isLength({ min: 1 }).trim(),
    body('time_limit_ms').isInt({ min: 100 }),
    body('memory_limit_mb').isInt({ min: 10 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { id, title, author, time_limit_ms, memory_limit_mb } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [id, title, author, time_limit_ms, memory_limit_mb]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating problem:', error);
        res.status(500).json({ message: 'Error creating problem' });
    }
});

app.put('/admin/problems/:id', requireAuth, requireStaffOrAdmin, [
    body('id').isLength({ min: 1 }).trim().escape(), // New ID
    body('title').optional({ checkFalsy: true }).isLength({ min: 1 }).trim(),
    body('author').optional({ checkFalsy: true }).isLength({ min: 1 }).trim(),
    body('time_limit_ms').optional().isInt({ min: 100 }),
    body('memory_limit_mb').optional().isInt({ min: 10 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const oldId = req.params.id;
    const { id: newId, title, author, time_limit_ms, memory_limit_mb } = req.body;

    try {
        // If the ID is being changed, check if the new ID already exists
        if (oldId !== newId) {
            const existingProblem = await db.query('SELECT id FROM problems WHERE id = $1', [newId]);
            if (existingProblem.rows.length > 0) {
                return res.status(409).json({ message: `Problem ID '${newId}' already exists.` });
            }
        }
        
        const result = await db.query(
            'UPDATE problems SET id = $1, title = $2, author = $3, time_limit_ms = $4, memory_limit_mb = $5 WHERE id = $6 RETURNING *',
            [newId, title, author, time_limit_ms, memory_limit_mb, oldId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Problem not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(`Error updating problem ${oldId}:`, error);
        res.status(500).json({ message: 'Error updating problem' });
    }
});

app.delete('/admin/problems/:id', requireAuth, requireStaffOrAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        // We also need to delete submissions for this problem
        await db.query('DELETE FROM submissions WHERE problem_id = $1', [id]);
        const result = await db.query('DELETE FROM problems WHERE id = $1 RETURNING id', [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Problem not found' });
        }
        res.status(200).json({ message: `Problem ${id} deleted successfully` });
    } catch (error) {
        console.error(`Error deleting problem ${id}:`, error);
        res.status(500).json({ message: 'Error deleting problem' });
    }
});

app.get('/admin/authors', requireAuth, requireStaffOrAdmin, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, username FROM users WHERE role = 'admin' OR role = 'staff' ORDER BY username"
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching authors:', error);
    res.status(500).json({ message: 'Error fetching authors' });
  }
});

app.get('/admin/problems', requireAuth, requireStaffOrAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT p.id, p.title, p.author, p.is_visible, p.contest_id, c.status AS contest_status FROM problems p LEFT JOIN contests c ON p.contest_id = c.id ORDER BY p.id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching problems for admin:', error);
    res.status(500).json({ message: 'Error fetching problems' });
  }
});

app.put('/admin/problems/:id/visibility', requireAuth, requireStaffOrAdmin, [
  body('isVisible').isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { isVisible } = req.body;
  
  try {
    const result = await db.query(
      'UPDATE problems SET is_visible = $1 WHERE id = $2 RETURNING id, title, is_visible',
      [isVisible, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Problem not found' });
    }
    res.json({ 
      message: `Problem ${id} visibility updated successfully`, 
      problem: result.rows[0] 
    });
  } catch (error) {
    console.error(`Error updating visibility for problem ${id}:`, error);
    res.status(500).json({ message: 'Error updating problem visibility' });
  }
});

app.post('/admin/problems/batch-upload', requireAuth, requireAdmin, diskUpload.single('problemsZip'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No zip file uploaded.' });
  }

  // Generate a unique progress ID for this upload
  const progressId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    res.status(202).json({
      message: 'Batch upload initiated. Connect to progress endpoint to monitor.',
      progressId: progressId
    });

    const batchResults = await processBatchUpload(req.file.path, (progressData) => {
      const clientRes = progressMap.get(progressId);
      if (clientRes && !clientRes.finished) {
        clientRes.write(`event: progress\ndata: ${JSON.stringify(progressData)}\n\n`);
      }
    });

    const clientRes = progressMap.get(progressId);
    if (clientRes && !clientRes.finished) {
      clientRes.write(`event: complete\ndata: ${JSON.stringify({ status: 'complete', message: 'Batch upload process finished.', ...batchResults })}\n\n`);
      clientRes.end();
    }
    progressMap.delete(progressId); // Clean up after completion

  } catch (error) {
    console.error('Error in batch upload endpoint:', error);
    const clientRes = progressMap.get(progressId);
    if (clientRes && !clientRes.finished) {
      clientRes.write(`event: error\ndata: ${JSON.stringify({ status: 'error', message: error.message || 'A critical error occurred during batch upload.' })}\n\n`);
      clientRes.end();
    }
    progressMap.delete(progressId);
  }
});

app.get('/admin/problems/batch-upload-progress/:progressId', requireAuth, requireAdmin, (req, res) => {
  const { progressId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*' 
  });

  progressMap.set(progressId, res);

  res.write(`event: initial\ndata: ${JSON.stringify({ message: 'Connected to batch upload progress stream.', progressId: progressId })}\n\n`);

  req.on('close', () => {
    if (progressMap.get(progressId) === res) {
      progressMap.delete(progressId);
    }
  });
});

app.post('/admin/problems/:id/upload', requireAuth, requireStaffOrAdmin, memoryUpload.fields([
  { name: 'problemPdf', maxCount: 1 },
  { name: 'testcasesZip', maxCount: 1 }
]), async (req, res) => {
  const { id } = req.params;
  const problemPdfFile = req.files['problemPdf'] ? req.files['problemPdf'][0] : null;
  const testcasesZipFile = req.files['testcasesZip'] ? req.files['testcasesZip'][0] : null;

  if (!problemPdfFile && !testcasesZipFile) {
    return res.status(400).json({ message: 'No files uploaded.' });
  }

  try {
    // Handle PDF upload
    if (problemPdfFile) {
      const pdfBuffer = problemPdfFile.buffer;
      await db.query('UPDATE problems SET problem_pdf = $1 WHERE id = $2', [pdfBuffer, id]);
    }

    // Handle Testcases ZIP upload
    if (testcasesZipFile) {
      // Clear existing testcases for this problem
      await db.query('DELETE FROM testcases WHERE problem_id = $1', [id]);

      const zip = await unzipper.Open.buffer(testcasesZipFile.buffer);
      const testcaseFiles = {};
      const fileRegex = /^(?:input|output)?(\d+)\.(?:in|out|txt)$/i;

      // First pass: Iterate through all files in the zip to find pairs
      for (const file of zip.files) {
        const fileName = path.basename(file.path);
        const isJunk = file.path.startsWith('__MACOSX/') || fileName.startsWith('._');

        if (file.type !== 'File' || isJunk) {
          continue; // Skip directories and junk files
        }

        const match = fileName.match(fileRegex);
        if (match) {
          const number = parseInt(match[1], 10);
          if (!testcaseFiles[number]) {
            testcaseFiles[number] = {};
          }

          const lowerFileName = fileName.toLowerCase();
          if (lowerFileName.endsWith('.in') || lowerFileName.includes('input')) {
             testcaseFiles[number].in = file;
          } else if (lowerFileName.endsWith('.out') || lowerFileName.includes('output')) {
             testcaseFiles[number].out = file;
          }
        }
      }

      // Second pass: read content and insert into DB
      const sortedKeys = Object.keys(testcaseFiles).map(Number).sort((a, b) => a - b);
      const pairedCases = sortedKeys.filter(key => testcaseFiles[key].in && testcaseFiles[key].out);
      
      if (pairedCases.length === 0) {
          return res.status(400).json({ message: 'No valid testcase pairs (.in/.out or input/output) found in the ZIP file.' });
      }
      
      let caseCounter = 1;
      for (const key of pairedCases) {
        const pair = testcaseFiles[key];
        const inputData = await pair.in.buffer();
        const outputData = await pair.out.buffer();

        await db.query(
          'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
          [id, caseCounter, inputData.toString('utf-8'), outputData.toString('utf-8')]
        );

        caseCounter++;
      }
    }

    res.status(200).json({ message: 'Files processed successfully.' });

  } catch (error) {
    console.error(`Error processing uploads for problem ${id}:`, error);
    res.status(500).json({ message: 'An error occurred during file processing.' });
  }
});

// Admin API Endpoints for settings
app.get('/admin/settings/registration', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'"
    );
    if (result.rows.length === 0) {
      // If the setting doesn't exist for some reason, default to true
      return res.json({ enabled: true });
    }
    res.json({ enabled: result.rows[0].setting_value === 'true' });
  } catch (error) {
    console.error('Error fetching registration setting:', error);
    res.status(500).json({ message: 'Error fetching settings' });
  }
});

app.put('/admin/settings/registration', requireAuth, requireAdmin, [
  body('enabled').isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { enabled } = req.body;
  try {
    await db.query(
      "UPDATE system_settings SET setting_value = $1 WHERE setting_key = 'registration_enabled'",
      [enabled.toString()]
    );
    res.status(200).json({ message: 'Registration setting updated successfully.' });
  } catch (error) {
    console.error('Error updating registration setting:', error);
    res.status(500).json({ message: 'Error updating setting' });
  }
});

// Admin API Endpoints for Database Management
app.post('/admin/database/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const dbName = process.env.PGDATABASE;
    const dbUser = process.env.PGUSER;
    const dbHost = process.env.PGHOST;
    const dbPort = process.env.PGPORT;

    // Use a temporary file to store the dump
    const dumpFilePath = path.join('/tmp', `db_backup_${Date.now()}.sql`);

    // Command to run pg_dump. Using plain SQL format.
    // Ensure that pg_dump is available in the Docker container where backend runs.
    const pgDumpCommand = `PGPASSWORD=${process.env.PGPASSWORD} pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F p -f ${dumpFilePath}`;
    
    console.log(`Executing pg_dump command: ${pgDumpCommand}`);
    await execPromise(pgDumpCommand);

    // Send the file as a download
    res.download(dumpFilePath, `oj_backup_${Date.now()}.sql`, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        // If an error occurs during download, and headers might have been sent,
        // we can't send another response. This is a fallback.
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading backup file.' });
        }
      }
      // Clean up the temporary dump file
      fs.unlink(dumpFilePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting temp dump file:', unlinkErr);
      });
    });

  } catch (error) {
    console.error('Error during database export:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to export database.', error: error.message });
    }
  }
});

app.post('/admin/database/import', requireAuth, requireAdmin, diskUpload.single('databaseDump'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No database dump file uploaded.' });
  }

  try {
    const dbName = process.env.PGDATABASE;
    const dbUser = process.env.PGUSER;
    const dbHost = process.env.PGHOST;
    const dbPort = process.env.PGPORT;
    const dumpFilePath = req.file.path; // Path to the uploaded file

    // Determine if it's a plain SQL file or a custom/tar dump
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let importCommand = '';

    // NOTE: For a real production system, you might want to stop the backend
    // and/or frontend services before importing to prevent data corruption
    // and restart them afterwards. This would typically be handled by a
    // more sophisticated deployment/orchestration system or a manual process.
    // For this context, we're assuming a development/test environment where
    // a brief inconsistency is acceptable or handled externally.

    if (fileExtension === '.sql') {
      // For plain SQL files, use psql
      // -f reads from file, -1 for single transaction
      importCommand = `PGPASSWORD=${process.env.PGPASSWORD} psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -f ${dumpFilePath} -v ON_ERROR_STOP=1`;
    } else if (fileExtension === '.dump' || fileExtension === '.tar') {
      // For custom/tar format dumps, use pg_restore
      importCommand = `PGPASSWORD=${process.env.PGPASSWORD} pg_restore -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -v ${dumpFilePath}`;
    } else {
      fs.unlink(dumpFilePath, (unlinkErr) => { // Clean up temp file
        if (unlinkErr) console.error('Error deleting unsupported dump file:', unlinkErr);
      });
      return res.status(400).json({ message: 'Unsupported file type. Only .sql, .dump, or .tar files are allowed.' });
    }

    // IMPORTANT: Drop all existing tables before importing to ensure a clean state.
    // This is a destructive operation and should be used with extreme caution.
    console.log('Dropping existing tables before import...');

    // Drop Contest tables first
    await db.query('DROP TABLE IF EXISTS contest_scoreboards CASCADE;');
    await db.query('DROP TABLE IF EXISTS contest_problems CASCADE;');
    await db.query('DROP TABLE IF EXISTS contest_submissions CASCADE;');
    await db.query('DROP TABLE IF EXISTS contest_participants CASCADE;');
    await db.query('DROP TABLE IF EXISTS contests CASCADE;');
    
    // Drop main tables
    await db.query('DROP TABLE IF EXISTS submissions CASCADE;');
    await db.query('DROP TABLE IF EXISTS testcases CASCADE;');
    await db.query('DROP TABLE IF EXISTS problems CASCADE;');
    await db.query('DROP TABLE IF EXISTS users CASCADE;');
    await db.query('DROP TABLE IF EXISTS user_sessions CASCADE;');
    await db.query('DROP TABLE IF EXISTS system_settings CASCADE;');

    console.log(`Executing database import command: ${importCommand}`);
    await execPromise(importCommand);

    // After import, re-initialize the database (e.g., create default settings, etc.)
    // This is important if the dump file does not contain all system_settings or default data.
    // However, for a full dump, this might not be strictly necessary if the dump contains everything.
    // For simplicity, we'll assume the dump is comprehensive.

    res.status(200).json({ message: 'Database imported successfully.' });

  } catch (error) {
    console.error('Error during database import:', error);
    res.status(500).json({ message: 'Failed to import database.', error: error.message });
  } finally {
    // Clean up the temporary dump file in all cases
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting temporary dump file:', unlinkErr);
      });
    }
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  
  // Start Contest Scheduler
  try {
    contestScheduler.start();
    console.log('✅ Contest Scheduler initialized successfully');
  } catch (error) {
    console.error('❌ Failed to start Contest Scheduler:', error);
  }
}); 