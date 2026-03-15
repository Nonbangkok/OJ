const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { memoryUpload } = require('../middleware/upload');
const { processSubmission, processContestSubmission } = require('../services/submissionService');
const { USER_ROLES, SUBMISSION_STATUS, CONTEST_STATUS } = require('../constants');

router.post('/submit', requireAuth, memoryUpload.none(), async (req, res) => {
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
      if (contest.status !== CONTEST_STATUS.RUNNING) {
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
         VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id`,
        [contestId, userId, problemId, code, language, SUBMISSION_STATUS.PENDING]
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
         VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
        [userId, problemId, code, language, SUBMISSION_STATUS.PENDING]
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

router.get('/submissions', requireAuth, async (req, res) => {
  const { filter, problemId, contestId } = req.query;
  const { userId, role } = req.session;
  const isStaffOrAdmin = role === USER_ROLES.ADMIN || role === USER_ROLES.STAFF;

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

    if (isStaffOrAdmin) {
      const { filterProblemId, filterUserId } = req.query;

      if (filterProblemId) {
        // Flexible matching for "auto-correct" feel, or exact match if selected from autocomplete
        // Using ILIKE for case-insensitive partial match if they typed it manually
        params.push(`%${filterProblemId}%`);
        conditions.push(`${contestId ? 'cs' : 's'}.problem_id IN (SELECT id FROM problems WHERE id ILIKE $${params.length})`);
      }

      if (filterUserId) {
        params.push(`%${filterUserId}%`);
        conditions.push(`${contestId ? 'cs' : 's'}.user_id IN (SELECT id FROM users WHERE username ILIKE $${params.length})`);
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY ${contestId ? 'cs' : 's'}.submitted_at DESC LIMIT 200;`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ message: 'Error fetching submissions' });
  }
});

// Autocomplete/Search Endpoints
router.get('/search/problems', requireAuth, async (req, res) => {
  const { q, contestId } = req.query;
  if (!q) return res.json([]);

  try {
    let result;
    if (contestId) {
      // Check if contest is finished or active to search correct table
      const contestRes = await db.query('SELECT status FROM contests WHERE id = $1', [contestId]);
      if (contestRes.rows.length === 0) return res.json([]);

      const status = contestRes.rows[0].status;

      if (status === CONTEST_STATUS.FINISHED) {
        result = await db.query(
          `SELECT problem_id as id, title FROM contest_problems 
           WHERE contest_id = $1 AND (problem_id ILIKE $2 OR title ILIKE $2) 
           LIMIT 10`,
          [contestId, `%${q}%`]
        );
      } else {
        result = await db.query(
          `SELECT id, title FROM problems 
           WHERE contest_id = $1 AND (id ILIKE $2 OR title ILIKE $2) 
           LIMIT 10`,
          [contestId, `%${q}%`]
        );
      }
    } else {
      // Global search
      result = await db.query(
        'SELECT id, title FROM problems WHERE id ILIKE $1 OR title ILIKE $1 LIMIT 10',
        [`%${q}%`]
      );
    }
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching problems:', error);
    res.status(500).json({ message: 'Error searching problems' });
  }
});

router.get('/search/users', requireAuth, async (req, res) => {
  const { q, contestId } = req.query;
  if (!q) return res.json([]);

  try {
    let result;
    if (contestId) {
      result = await db.query(
        `SELECT u.username FROM users u
         JOIN contest_participants cp ON u.id = cp.user_id
         WHERE cp.contest_id = $1 AND u.username ILIKE $2
         LIMIT 10`,
        [contestId, `%${q}%`]
      );
    } else {
      result = await db.query(
        'SELECT username FROM users WHERE username ILIKE $1 LIMIT 10',
        [`%${q}%`]
      );
    }
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ message: 'Error searching users' });
  }
});

router.get('/submissions/:id', requireAuth, async (req, res) => {
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
    const isStaffOrAdmin = role === USER_ROLES.ADMIN || role === USER_ROLES.STAFF;

    if (!isOwner && !isStaffOrAdmin) {
      return res.status(403).json({ message: 'You are not authorized to view this submission.' });
    }

    res.json(submission);
  } catch (error) {
    console.error(`Error fetching submission ${id}:`, error);
    res.status(500).json({ message: 'Error fetching submission details' });
  }
});

router.get('/scoreboard', requireAuth, async (req, res) => {
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

module.exports = router;