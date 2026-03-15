const express = require('express');
const router = express.Router();
const db = require('../db');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require('../middleware/auth');
const { diskUpload, memoryUpload } = require('../middleware/upload');
const unzipper = require('unzipper');
const path = require('path');
const archiver = require('archiver');
const { processBatchUpload } = require('../services/batchUploadService');
const { PROBLEM_VALIDATION, USER_ROLES } = require('../constants');
const progressMap = new Map();

router.get('/problems-with-stats', requireAuth, async (req, res) => {
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
router.get('/problems', async (req, res) => {
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

// Public details
router.get('/problems/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT id, title, author, time_limit_ms, memory_limit_mb, (problem_pdf IS NOT NULL) as has_pdf, is_visible FROM problems WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Problem not found' });
    }

    // Allow admin/staff to view hidden problems, otherwise apply visibility check
    const isStaffOrAdmin = req.session.role === USER_ROLES.ADMIN || req.session.role === USER_ROLES.STAFF;

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

// Admin details - guaranteed to return everything
router.get('/admin/problems/:id', requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT id, title, author, time_limit_ms, memory_limit_mb, is_visible, (problem_pdf IS NOT NULL) as has_pdf FROM problems WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Problem not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error fetching admin problem ${id}:`, error);
    res.status(500).json({ message: 'Error fetching problem details' });
  }
});

router.get('/problems/:id/pdf', requireAuth, async (req, res) => {
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

router.post('/admin/problems', requireAuth, requireStaffOrAdmin, [
  body('id').isLength({ min: 1 }).trim().escape(),
  body('title').isLength({ min: PROBLEM_VALIDATION.MIN_TITLE_LENGTH }).trim(),
  body('author').isLength({ min: PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH }).trim(),
  body('time_limit_ms').isInt({ min: PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS }),
  body('memory_limit_mb').isInt({ min: PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB })
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

router.put('/admin/problems/:id', requireAuth, requireStaffOrAdmin, [
  body('id').isLength({ min: 1 }).trim().escape(), // New ID
  body('title').optional({ checkFalsy: true }).isLength({ min: PROBLEM_VALIDATION.MIN_TITLE_LENGTH }).trim(),
  body('author').optional({ checkFalsy: true }).isLength({ min: PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH }).trim(),
  body('time_limit_ms').optional().isInt({ min: PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS }),
  body('memory_limit_mb').optional().isInt({ min: PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB })
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

    // Update problem_id in contest_problems and contest_submissions if problem ID changed
    if (oldId !== newId) {
      await db.query('UPDATE contest_problems SET problem_id = $1 WHERE problem_id = $2', [newId, oldId]);
      await db.query('UPDATE contest_submissions SET problem_id = $1 WHERE problem_id = $2', [newId, oldId]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Problem not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error updating problem ${oldId}:`, error);
    res.status(500).json({ message: 'Error updating problem' });
  }
});

router.delete('/admin/problems/:id', requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // We also need to delete submissions for this problem
    await db.query('DELETE FROM submissions WHERE problem_id = $1', [id]);
    await db.query('DELETE FROM testcases WHERE problem_id = $1', [id]);
    await db.query('DELETE FROM contest_problems WHERE problem_id = $1', [id]);
    await db.query('DELETE FROM contest_submissions WHERE problem_id = $1', [id]);
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

router.get('/admin/problems', requireAuth, requireStaffOrAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT p.id, p.title, p.author, p.is_visible, p.contest_id, c.status AS contest_status FROM problems p LEFT JOIN contests c ON p.contest_id = c.id ORDER BY p.id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching problems for admin:', error);
    res.status(500).json({ message: 'Error fetching problems' });
  }
});

router.put('/admin/problems/:id/visibility', requireAuth, requireStaffOrAdmin, [
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

router.post('/admin/problems/batch-upload', requireAuth, requireStaffOrAdmin, diskUpload.single('problemsZip'), async (req, res) => {
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

router.get('/admin/problems/batch-upload-progress/:progressId', requireAuth, requireStaffOrAdmin, (req, res) => {
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

router.post('/admin/problems/:id/upload', requireAuth, requireStaffOrAdmin, memoryUpload.fields([
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
      const fileRegex = /^(?:input|output)?(\d+)\.(?:in|out|txt|sol)$/i;

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
          } else if (lowerFileName.endsWith('.out') || lowerFileName.endsWith('.sol') || lowerFileName.includes('output')) {
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

// Admin API Endpoints for Problem Export
router.post('/admin/problems/export', requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { problemIds } = req.body; // Expects an array of problem IDs to export

  if (!problemIds || !Array.isArray(problemIds) || problemIds.length === 0) {
    return res.status(400).json({ message: 'No problem IDs provided for export.' });
  }

  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });

  const timestamp = Date.now();
  const outputFileName = `problems_export_${timestamp}.zip`;

  // Set headers for file download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);

  // Pipe the archive directly to the response
  archive.pipe(res);

  archive.on('error', (err) => {
    console.error('Archive error during streaming export:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error creating problem export zip.', error: err.message });
    }
    res.end(); // End the response even if headers were sent
  });

  try {
    for (const problemId of problemIds) {
      const problemRes = await db.query(
        'SELECT id, title, author, time_limit_ms, memory_limit_mb, problem_pdf FROM problems WHERE id = $1',
        [problemId]
      );

      if (problemRes.rows.length === 0) {
        console.warn(`Problem ${problemId} not found, skipping export.`);
        continue;
      }

      const problem = problemRes.rows[0];
      const problemFolderName = `${problem.id}`; // Use problem ID as folder name

      // 1. Add config.json
      const config = {
        id: problem.id,
        title: problem.title,
        author: problem.author,
        time_limit_ms: problem.time_limit_ms,
        memory_limit_mb: problem.memory_limit_mb,
      };
      archive.append(JSON.stringify(config, null, 2), { name: `${problemFolderName}/config.json` });

      // 2. Add problem PDF (if exists)
      if (problem.problem_pdf) {
        archive.append(problem.problem_pdf, { name: `${problemFolderName}/${problem.id}.pdf` });
      }

      // 3. Add test cases (input/output)
      const testcasesRes = await db.query(
        'SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 ORDER BY case_number ASC',
        [problemId]
      );

      if (testcasesRes.rows.length > 0) {
        for (const testcase of testcasesRes.rows) {
          const caseNumberPadded = testcase.case_number.toString().padStart(2, '0'); // e.g., 01, 02
          archive.append(testcase.input_data, { name: `${problemFolderName}/testcases/input/input${caseNumberPadded}.txt` });
          archive.append(testcase.output_data, { name: `${problemFolderName}/testcases/output/output${caseNumberPadded}.txt` });
        }
      }
    }

    archive.finalize();

  } catch (error) {
    console.error('Error during problem export:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to export problems.', error: error.message });
    }
    archive.abort();
    res.end(); // Ensure response is ended on error
  }
});

module.exports = router;