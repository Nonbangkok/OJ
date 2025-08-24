const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('./db'); // This is your existing pg pool from db.js
const multer = require('multer');
const unzipper = require('unzipper');
const { v4: uuidv4 } = require('uuid'); // Add uuid for job tracking
const isMac = process.platform === 'darwin';

// In-memory store for upload job progress
const uploadJobs = {};

// Setup for file uploads
const upload = multer({ dest: 'uploads/' });

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL session store setup
app.use(session({
  store: new pgSession({
    pool: db.pool, // Use the existing pg pool from db.js
    tableName: 'user_sessions', // Name of the table to store sessions
  }),
  secret: process.env.SECRET_KEY || 'supersecretkeyformemorydevelopmentonly', // Use environment variable
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Add this line
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: 'Authentication required' });
  }
};

// Middleware to check if user is an admin
const requireAdmin = (req, res, next) => {
  if (req.session.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};

// Middleware to check if user is a staff member or an admin
const requireStaffOrAdmin = (req, res, next) => {
  if (req.session.role === 'admin' || req.session.role === 'staff') {
    next();
  } else {
    res.status(403).json({ message: 'Staff or Admin access required' });
  }
};

async function runSingleCase(executablePath, input, timeLimitMs, memoryLimitMb) {
  return new Promise((resolve) => {
    // Command differs between macOS (BSD time) and Linux (GNU time)
    const timeCommand = isMac 
      ? `/usr/bin/time -l` 
      : `/usr/bin/time -f "TIME_USED:%e MEM_USED:%M"`;
      
    const command = `(ulimit -v ${memoryLimitMb * 1024}; ${timeCommand} ${executablePath})`;
    const executionOptions = { timeout: timeLimitMs, maxBuffer: 50 * 1024 * 1024 }; // 50MB buffer

    const child = exec(command, executionOptions, (error, stdout, stderr) => {
      let timeMs = -1;
      let memoryKb = -1;
      let programOutput = stdout;
      let programStderr = stderr;

      if (stderr) {
        if (isMac) {
          const timeMatch = stderr.match(/(\d+\.\d+)\s+user\s+(\d+\.\d+)\s+sys/);
          const memMatch = stderr.match(/(\d+)\s+maximum resident set size/);
          if (timeMatch) {
            const userTime = parseFloat(timeMatch[1]);
            const sysTime = parseFloat(timeMatch[2]);
            timeMs = Math.round((userTime + sysTime) * 1000);
          }
          if (memMatch) {
            memoryKb = Math.round(parseInt(memMatch[1], 10) / 1024); // Convert bytes to KB
          }
        } else { // Linux
          const timeRegex = /TIME_USED:([0-9.]+)/;
          const memRegex = /MEM_USED:(\d+)/;
          const timeMatch = stderr.match(timeRegex);
          const memMatch = stderr.match(memRegex);
          if (timeMatch) timeMs = Math.round(parseFloat(timeMatch[1]) * 1000);
          if (memMatch) memoryKb = parseInt(memMatch[1], 10);
        }
        // Clean stderr for reporting
        programStderr = stderr.split('\n').slice(isMac ? 1 : 0).filter(line => !line.includes('MEM_USED') && !line.includes('maximum resident set size')).join('\n').trim();
      }

      if (error) {
        // Did it time out?
        if (timeMs >= timeLimitMs || error.killed && error.signal === 'SIGTERM') {
          return resolve({ status: 'Time Limit Exceeded', timeMs: timeLimitMs, memoryKb });
        }
        // Did it run out of memory? SIGSEGV is a common indicator.
        if (error.signal === 'SIGSEGV') {
          return resolve({ status: 'Memory Limit Exceeded', timeMs, memoryKb: memoryLimitMb * 1024 });
        }
        return resolve({ status: 'Runtime Error', output: programStderr, timeMs, memoryKb });
      }
      
      resolve({ status: 'Pending', output: programOutput, timeMs, memoryKb });
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

    const testcasesDir = path.join(__dirname, 'problems', problemId, 'testcases');
    const files = await fs.promises.readdir(testcasesDir);
    
    const inFileRegex = /(\d+)\.in$/;
    const inFiles = files
      .filter(f => inFileRegex.test(f))
      .sort((a, b) => parseInt(a.match(inFileRegex)[1]) - parseInt(b.match(inFileRegex)[1]));

    if (inFiles.length === 0) {
      return { overallStatus: "System Error", score: 0, results: [{ testCase: 1, status: 'No test cases found' }] };
    }

    const results = [];
    for (let i = 0; i < inFiles.length; i++) {
      const inFile = inFiles[i];
      const caseNumber = parseInt(inFile.match(inFileRegex)[1]);
      const outFile = `${caseNumber}.out`;

      if (!files.includes(outFile)) {
        results.push({ testCase: caseNumber, status: 'System Error: Missing output file' });
        continue; // Skip to next test case
      }

      const input = await fs.promises.readFile(path.join(testcasesDir, inFile), 'utf8');
      const expectedOutput = await fs.promises.readFile(path.join(testcasesDir, outFile), 'utf8');

      const runResult = await runSingleCase(executablePath, input, time_limit_ms, memory_limit_mb);
      
      // Now, compare output
      if (runResult.status === 'Pending') {
        const formattedStdout = runResult.output.trim().replace(/\r\n/g, '\n');
        const formattedExpectedOutput = expectedOutput.trim().replace(/\r\n/g, '\n');
        if (formattedStdout === formattedExpectedOutput) {
          runResult.status = 'Accepted';
        } else {
          runResult.status = 'Wrong Answer';
        }
      }
      
      results.push({
        testCase: caseNumber,
        status: runResult.status,
        timeMs: runResult.timeMs,
        memoryKb: runResult.memoryKb,
        output: runResult.status !== 'Accepted' && runResult.status !== 'Wrong Answer' ? runResult.output : undefined,
      });
      
      // Stop on first non-Accepted result for immediate feedback
      if (runResult.status !== 'Accepted') {
        // To show all results, comment out the loop break.
        // For now, let's fill the rest with 'Skipped' to show the user there are more.
        for (let j = i + 1; j < inFiles.length; j++) {
            const skippedCaseNum = parseInt(inFiles[j].match(inFileRegex)[1]);
            results.push({ testCase: skippedCaseNum, status: 'Skipped' });
        }
        break; 
      }
    }

    const passedCases = results.filter(r => r.status === 'Accepted').length;
    const totalCases = inFiles.length;
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
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password } = req.body;

  try {
    // Check if username or email already exists
    const existingUser = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Username or email already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert new user
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
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
    // Find user by username or email
    const result = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
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
        email: user.email,
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

app.post('/submit', requireAuth, (req, res) => {
  const { problemId, language, code } = req.body;

  if (language !== 'cpp') {
    return res.status(400).json({ message: 'Only C++ is supported.' });
  }
  if (!problemId) {
    return res.status(400).json({ message: 'Problem ID is required.' });
  }

  const submissionId = Date.now();
  const filePath = path.join(__dirname, 'submissions', `${submissionId}.cpp`);
  const outputPath = path.join(__dirname, 'submissions', `${submissionId}.out`);

  fs.writeFile(filePath, code, (err) => {
    if (err) {
      console.error('Error writing file:', err);
      return res.status(500).json({ message: 'Error saving the code file.' });
    }

    const compileCommand = `clang++ -std=c++20 ${filePath} -o ${outputPath}`;
    exec(compileCommand, async (error, stdout, stderr) => {
      // Delete the source .cpp file
      fs.unlink(filePath, (err) => { if (err) console.error("Error deleting .cpp file:", err); });

      if (error) {
          console.error('Compilation error:', stderr);
          // The frontend expects a full result object for consistent display
          return res.status(200).json({
              overallStatus: 'Compilation Error',
              score: 0,
              output: stderr,
              results: [],
              maxTimeMs: 0,
              maxMemoryKb: 0,
          });
      }

      try {
          // Set executable permissions, which is a common cause of runtime errors
          await fs.promises.chmod(outputPath, 0o755);

          // Run the judge
          const judgeResult = await judge(problemId, outputPath);

          // Save submission to database
          try {
              const { results, score, overallStatus, maxTimeMs, maxMemoryKb } = judgeResult;
              await db.query(
                  `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results, max_time_ms, max_memory_kb)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                  [req.session.userId, problemId, code, language, overallStatus, score, JSON.stringify(results), maxTimeMs, maxMemoryKb]
              );
          } catch (dbError) {
              console.error("Error saving submission to DB:", dbError);
              // Don't fail the request, just log the error and continue
          }

          res.status(200).json(judgeResult);
      } catch (judgeError) {
          console.error("Judging system error:", judgeError);
          res.status(500).json({ message: "Internal server error during judging." });
      } finally {
          // Clean up the executable file
          fs.unlink(outputPath, (err) => { if (err) console.error("Error deleting .out file:", err); });
      }
    });
  });
});

app.get('/api/problems-with-stats', requireAuth, async (req, res) => {
  const { userId } = req.session;
  try {
    const query = `
      WITH UserProblemStats AS (
        SELECT
          problem_id,
          MAX(score) AS best_score,
          COUNT(*) AS submission_count,
          MAX(id) AS latest_submission_id
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
        s.submitted_at AS latest_submission_at,
        s.overall_status AS latest_submission_status,
        s.results AS latest_submission_results
      FROM problems p
      LEFT JOIN UserProblemStats ups ON p.id = ups.problem_id
      LEFT JOIN submissions s ON ups.latest_submission_id = s.id
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
app.get('/api/problems', async (req, res) => {
  try {
    const result = await db.query('SELECT id, title, author FROM problems ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching problems:', error);
    res.status(500).json({ message: 'Error fetching problems' });
  }
});

app.get('/api/problems/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT * FROM problems WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Problem not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error fetching problem ${id}:`, error);
    res.status(500).json({ message: 'Error fetching problem details' });
  }
});

app.get('/api/problems/:id/pdf', requireAuth, (req, res) => {
  const { id } = req.params;
  const pdfPath = path.join(__dirname, 'problems', id, 'pdf', `${id}.pdf`);
  
  fs.access(pdfPath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ message: 'Problem PDF not found.' });
    }
    res.sendFile(pdfPath);
  });
});

app.get('/api/submissions', requireAuth, async (req, res) => {
  const { filter, problemId } = req.query; // Add problemId
  const { userId } = req.session;
  
  try {
    let query = `
      SELECT 
        s.id, u.username, s.problem_id, p.title AS problem_title,
        s.overall_status, s.score, s.language, s.submitted_at
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      JOIN problems p ON s.problem_id = p.id
    `;
    const params = [];
    const conditions = [];

    if (filter === 'mine') {
      params.push(userId);
      conditions.push(`s.user_id = $${params.length}`);
    }

    if (problemId) {
      params.push(problemId);
      conditions.push(`s.problem_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY s.submitted_at DESC LIMIT 50;`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ message: 'Error fetching submissions' });
  }
});

app.get('/api/submissions/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, role } = req.session;

  try {
    const result = await db.query(
      'SELECT * FROM submissions WHERE id = $1',
      [id]
    );

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

app.get('/api/scoreboard', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      WITH UserBestScores AS (
        -- For each user and each problem, find their highest score
        SELECT
          user_id,
          problem_id,
          MAX(score) AS best_score
        FROM submissions
        GROUP BY user_id, problem_id
      )
      -- Now, sum up the best scores for each user
      SELECT
        u.username,
        SUM(ubs.best_score) AS total_score,
        COUNT(CASE WHEN ubs.best_score = 100 THEN 1 END) AS problems_solved
      FROM UserBestScores ubs
      JOIN users u ON ubs.user_id = u.id
      GROUP BY u.username
      ORDER BY total_score DESC, problems_solved DESC;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scoreboard:', error);
    res.status(500).json({ message: 'Error fetching scoreboard' });
  }
});


// Admin API Endpoints
// User Management
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, email, role, created_at FROM users ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, [
  body('email').isEmail().normalizeEmail(),
  body('role').isIn(['user', 'staff']) // Admin can only set role to user or staff
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { email, role } = req.body;

  try {
    const result = await db.query(
      'UPDATE users SET email = $1, role = $2 WHERE id = $3 RETURNING id, username, email, role',
      [email, role, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error updating user ${id}:`, error);
    res.status(500).json({ message: 'Error updating user' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
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

// Problem Management
app.post('/api/admin/problems', requireAuth, requireStaffOrAdmin, [
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

app.put('/api/admin/problems/:id', requireAuth, requireStaffOrAdmin, [
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

app.delete('/api/admin/problems/:id', requireAuth, requireStaffOrAdmin, async (req, res) => {
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

app.get('/api/admin/authors', requireAuth, requireStaffOrAdmin, async (req, res) => {
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

app.post('/api/admin/problems/:id/upload', requireAuth, requireStaffOrAdmin, upload.fields([
  { name: 'problemPdf', maxCount: 1 },
  { name: 'testcasesZip', maxCount: 1 }
]), (req, res) => { // NOTE: This is no longer an async function
  const { id } = req.params;
  const problemPdfFile = req.files['problemPdf'] ? req.files['problemPdf'][0] : null;
  const testcasesZipFile = req.files['testcasesZip'] ? req.files['testcasesZip'][0] : null;

  if (!problemPdfFile && !testcasesZipFile) {
    return res.status(400).json({ message: 'No files uploaded.' });
  }

  const jobId = uuidv4();
  uploadJobs[jobId] = { 
    status: 'starting', 
    progress: 0, 
    total: 0, 
    message: 'Upload process initiated...' 
  };
  
  // Respond immediately to the client with the job ID
  res.status(202).json({ message: 'File processing started.', jobId });

  // Start the actual processing in the background (fire and forget)
  processUploads(jobId, id, problemPdfFile, testcasesZipFile);
});

// New endpoint for polling upload progress
app.get('/api/admin/upload-progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = uploadJobs[jobId];

  if (!job) {
    return res.status(404).json({ message: 'Job not found.' });
  }

  res.json(job);

  // Clean up job from memory after it has been polled in a final state
  if (job.status === 'completed' || job.status === 'failed') {
    setTimeout(() => {
      delete uploadJobs[jobId];
    }, 60000); // Keep for 1 minute for the frontend to fetch the final status
  }
});

// This new function will run in the background
async function processUploads(jobId, id, problemPdfFile, testcasesZipFile) {
  try {
    const job = uploadJobs[jobId];
    
    // Handle PDF upload (unchanged)
    if (problemPdfFile) {
      job.message = 'Processing PDF...';
      const problemDir = path.join(__dirname, 'problems', id);
      const newPdfDir = path.join(problemDir, 'pdf');
      const newPdfPath = path.join(newPdfDir, `${id}.pdf`);
      await fs.promises.mkdir(newPdfDir, { recursive: true });
      await fs.promises.rename(problemPdfFile.path, newPdfPath);
      await db.query('UPDATE problems SET problem_pdf_path = $1 WHERE id = $2', [`/api/problems/${id}/pdf`, id]);
    }

    // Handle Testcases ZIP upload with progress tracking
    if (testcasesZipFile) {
      job.status = 'processing';
      job.message = 'Analyzing ZIP file...';
      
      const testcasesDir = path.join(__dirname, 'problems', id, 'testcases');
      await fs.promises.rm(testcasesDir, { recursive: true, force: true });
      await fs.promises.mkdir(testcasesDir, { recursive: true });

      // Use unzipper.Open.file for more reliable directory parsing
      const zip = await unzipper.Open.file(testcasesZipFile.path);
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
          // Prioritize .in/.out extensions, then check for "input"/"output" in filename
          if (lowerFileName.endsWith('.in')) {
             testcaseFiles[number].in = file;
          } else if (lowerFileName.endsWith('.out')) {
             testcaseFiles[number].out = file;
          } else if (lowerFileName.includes('input')) {
             testcaseFiles[number].in = file;
          } else if (lowerFileName.includes('output')) {
             testcaseFiles[number].out = file;
          }
        }
      }

      // Second pass: sort and write the collected entries
      const sortedKeys = Object.keys(testcaseFiles).map(Number).sort((a, b) => a - b);
      const pairedCases = sortedKeys.filter(key => testcaseFiles[key].in && testcaseFiles[key].out);
      
      job.total = pairedCases.length;
      if (job.total === 0) {
          job.status = 'failed';
          job.message = 'No valid testcase pairs (.in/.out or input/output) found in the ZIP file.';
          await fs.promises.unlink(testcasesZipFile.path);
          return; // Exit the function
      }
      
      let caseCounter = 1;
      const writePromises = [];

      for (const key of pairedCases) {
        const pair = testcaseFiles[key];
        job.progress = caseCounter;
        job.message = `Processing testcase ${job.progress} of ${job.total}...`;

        const inPath = path.join(testcasesDir, `${caseCounter}.in`);
        const outPath = path.join(testcasesDir, `${caseCounter}.out`);

        // Create write streams from the file entries
        writePromises.push(new Promise((resolve, reject) => 
          pair.in.stream().pipe(fs.createWriteStream(inPath)).on('finish', resolve).on('error', reject)
        ));
        writePromises.push(new Promise((resolve, reject) => 
          pair.out.stream().pipe(fs.createWriteStream(outPath)).on('finish', resolve).on('error', reject)
        ));
        caseCounter++;
      }
      
      await Promise.all(writePromises);
      await fs.promises.unlink(testcasesZipFile.path);
    }

    job.status = 'completed';
    job.message = 'All files processed successfully.';

  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    if (uploadJobs[jobId]) {
      uploadJobs[jobId].status = 'failed';
      uploadJobs[jobId].message = 'An error occurred during processing.';
    }
    // Cleanup failed uploads
    if (problemPdfFile) await fs.promises.unlink(problemPdfFile.path).catch(e => console.error('Cleanup error:', e));
    if (testcasesZipFile) await fs.promises.unlink(testcasesZipFile.path).catch(e => console.error('Cleanup error:', e));
  }
}

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
}); 