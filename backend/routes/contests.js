const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const problemMigration = require('../services/problemMigration');
const { requireAuth, requireStaffOrAdmin } = require('../middleware/auth');
const router = express.Router();

// ==========================================
// USER-FACING CONTEST ENDPOINTS
// ==========================================

// GET /api/contests - List all contests
router.get('/', async (req, res) => {
  const { userId } = req.session;
  
  try {
    let result;
    
    if (userId) {
      // If user is logged in, include participation status
      result = await db.query(`
        SELECT 
          c.id, c.title, c.description, c.start_time, c.end_time, c.status,
          c.created_at,
          COUNT(cp.user_id) as participant_count,
          CASE WHEN user_participation.user_id IS NOT NULL THEN true ELSE false END as is_participant,
          CASE 
            WHEN c.status = 'finished' THEN COALESCE(finished_problems.problem_count, 0)
            ELSE COALESCE(active_problems.problem_count, 0)
          END as problem_count
        FROM contests c
        LEFT JOIN contest_participants cp ON c.id = cp.contest_id
        LEFT JOIN (
          SELECT DISTINCT contest_id, user_id 
          FROM contest_participants 
          WHERE user_id = $1
        ) user_participation ON c.id = user_participation.contest_id
        LEFT JOIN (
          SELECT contest_id, COUNT(*) as problem_count
          FROM contest_problems
          GROUP BY contest_id
        ) finished_problems ON c.id = finished_problems.contest_id AND c.status = 'finished'
        LEFT JOIN (
          SELECT contest_id, COUNT(*) as problem_count
          FROM problems
          WHERE contest_id IS NOT NULL
          GROUP BY contest_id
        ) active_problems ON c.id = active_problems.contest_id AND c.status != 'finished'
        GROUP BY c.id, c.title, c.description, c.start_time, c.end_time, c.status, c.created_at, user_participation.user_id, finished_problems.problem_count, active_problems.problem_count
        ORDER BY c.start_time DESC
      `, [userId]);
    } else {
      // If no user logged in, just get basic contest info
      result = await db.query(`
        SELECT 
          c.id, c.title, c.description, c.start_time, c.end_time, c.status,
          c.created_at,
          COUNT(cp.user_id) as participant_count,
          false as is_participant,
          CASE 
            WHEN c.status = 'finished' THEN COALESCE(finished_problems.problem_count, 0)
            ELSE COALESCE(active_problems.problem_count, 0)
          END as problem_count
        FROM contests c
        LEFT JOIN contest_participants cp ON c.id = cp.contest_id
        LEFT JOIN (
          SELECT contest_id, COUNT(*) as problem_count
          FROM contest_problems
          GROUP BY contest_id
        ) finished_problems ON c.id = finished_problems.contest_id AND c.status = 'finished'
        LEFT JOIN (
          SELECT contest_id, COUNT(*) as problem_count
          FROM problems
          WHERE contest_id IS NOT NULL
          GROUP BY contest_id
        ) active_problems ON c.id = active_problems.contest_id AND c.status != 'finished'
        GROUP BY c.id, c.title, c.description, c.start_time, c.end_time, c.status, c.created_at, finished_problems.problem_count, active_problems.problem_count
        ORDER BY c.start_time DESC
      `);
    }
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching contests:', error);
    res.status(500).json({ message: 'Error fetching contests' });
  }
});

// GET /api/contests/available-problems - Get problems available for contest (Admin)
router.get('/available-problems', requireAuth, requireStaffOrAdmin, async (req, res) => {
  try {
    const problems = await problemMigration.getAvailableProblemsForContest();
    res.json(problems);
  } catch (error) {
    console.error('Error fetching available problems:', error);
    res.status(500).json({ message: 'Error fetching available problems' });
  }
});

// GET /api/contests/:id - Get contest details
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.session;
  
  try {
    const contestResult = await db.query(`
      SELECT 
        c.*,
        COUNT(cp.user_id) as participant_count,
        u.username as created_by_username
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = $1
      GROUP BY c.id, c.title, c.description, c.start_time, c.end_time, 
               c.status, c.created_at, c.created_by, u.username
    `, [id]);

    if (contestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Contest not found' });
    }

    const contest = contestResult.rows[0];
    
    // Check if current user is a participant
    let isParticipant = false;
    if (userId) {
      const participantResult = await db.query(`
        SELECT 1 FROM contest_participants 
        WHERE contest_id = $1 AND user_id = $2
      `, [id, userId]);
      isParticipant = participantResult.rows.length > 0;
    }
    
    // Get problems in this contest (only if contest has started)
    let problems = [];
    if (contest.status === 'running' || contest.status === 'finished') {
      if (contest.status === 'finished') {
        // For finished contests, get problems from contest_problems snapshot
        const problemsResult = await db.query(`
          SELECT problem_id as id, title, author
          FROM contest_problems 
          WHERE contest_id = $1
          ORDER BY problem_id
        `, [id]);
        problems = problemsResult.rows;
      } else {
        // For running contests, get problems from problems table
        const problemsResult = await db.query(`
          SELECT id, title, author
          FROM problems 
          WHERE contest_id = $1
          ORDER BY id
        `, [id]);
        problems = problemsResult.rows;
      }
    }

    res.json({ ...contest, problems, is_participant: isParticipant });
  } catch (error) {
    console.error(`Error fetching contest ${id}:`, error);
    res.status(500).json({ message: 'Error fetching contest details' });
  }
});

// POST /api/contests/:id/join - Join a contest
router.post('/:id/join', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.session;

  try {
    // Check if contest exists and is joinable
    const contestResult = await db.query(
      'SELECT * FROM contests WHERE id = $1',
      [id]
    );

    if (contestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Contest not found' });
    }

    const contest = contestResult.rows[0];
    
    // Check if contest is still open for registration (can join until end time)
    const now = new Date();
    const endTime = new Date(contest.end_time);
    
    if (now >= endTime) {
      return res.status(400).json({ 
        message: 'Cannot join contest that has already ended' 
      });
    }

    // Try to join (will fail if already joined due to PRIMARY KEY constraint)
    try {
      await db.query(
        'INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)',
        [id, userId]
      );
      res.json({ message: 'Successfully joined contest' });
    } catch (insertError) {
      if (insertError.code === '23505') { // unique_violation
        res.status(400).json({ message: 'Already joined this contest' });
      } else {
        throw insertError;
      }
    }
  } catch (error) {
    console.error(`Error joining contest ${id}:`, error);
    res.status(500).json({ message: 'Error joining contest' });
  }
});

// GET /api/contests/:id/scoreboard - Get contest scoreboard
router.get('/:id/scoreboard', requireAuth, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Check if contest exists
    const contestResult = await db.query('SELECT * FROM contests WHERE id = $1', [id]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Contest not found' });
    }

    const contest = contestResult.rows[0];

    if (contest.status === 'finished') {
      // Get final scoreboard from contest_scoreboards table with problems information
      const [scoreboardResult, problemsResult] = await Promise.all([
        db.query(`
          SELECT 
            cs.*,
            u.username
          FROM contest_scoreboards cs
          JOIN users u ON cs.user_id = u.id
          WHERE cs.contest_id = $1
          ORDER BY cs.total_score DESC
        `, [id]),
        db.query(`
          SELECT problem_id, title
          FROM contest_problems
          WHERE contest_id = $1
          ORDER BY problem_id
        `, [id])
      ]);
      
      res.json({
        scoreboard: scoreboardResult.rows,
        problems: problemsResult.rows
      });
    } else if (contest.status === 'running' || contest.status === 'finishing') {
      // Generate real-time scoreboard and fetch current problems
      const [scoreboardResult, problemsResult] = await Promise.all([
        db.query(`
          WITH UserBestScores AS (
            SELECT
              cs.user_id,
              cs.problem_id,
              MAX(cs.score) AS best_score,
              COUNT(*) AS attempts
            FROM contest_submissions cs
            WHERE cs.contest_id = $1
            GROUP BY cs.user_id, cs.problem_id
          ),
          UserTotalScores AS (
            SELECT
              ubs.user_id,
              SUM(ubs.best_score) AS total_score,
              jsonb_object_agg(ubs.problem_id, jsonb_build_object(
                'score', ubs.best_score,
                'attempts', ubs.attempts
              )) AS detailed_scores
            FROM UserBestScores ubs
            GROUP BY ubs.user_id
          ),
          AllParticipants AS (
            SELECT
              cp.user_id,
              u.username,
              COALESCE(uts.total_score, 0) AS total_score,
              COALESCE(uts.detailed_scores, '{}'::jsonb) AS detailed_scores
            FROM contest_participants cp
            JOIN users u ON cp.user_id = u.id
            LEFT JOIN UserTotalScores uts ON uts.user_id = cp.user_id
            WHERE cp.contest_id = $1
          )
          SELECT *
          FROM AllParticipants
          ORDER BY total_score DESC, username ASC
        `, [id]),
        db.query(`
          SELECT id as problem_id, title
          FROM problems
          WHERE contest_id = $1
          ORDER BY id
        `, [id])
      ]);
      
      res.json({
        scoreboard: scoreboardResult.rows,
        problems: problemsResult.rows
      });
    } else {
      // Contest not started yet, but show participants with zero scores and problems
      const [participantsResult, problemsResult] = await Promise.all([
        db.query(`
          SELECT 
            cp.user_id,
            u.username,
            0 AS total_score,
            '{}'::jsonb AS detailed_scores
          FROM contest_participants cp
          JOIN users u ON cp.user_id = u.id
          WHERE cp.contest_id = $1
          ORDER BY u.username ASC
        `, [id]),
        db.query(`
          SELECT id as problem_id, title
          FROM problems
          WHERE contest_id = $1
          ORDER BY id
        `, [id])
      ]);
      
      res.json({
        scoreboard: participantsResult.rows,
        problems: problemsResult.rows
      });
    }
  } catch (error) {
    console.error(`Error fetching scoreboard for contest ${id}:`, error);
    res.status(500).json({ message: 'Error fetching contest scoreboard' });
  }
});

// ==========================================
// ADMIN CONTEST ENDPOINTS
// ==========================================

// POST /api/contests - Create new contest (Admin only)
router.post('/', requireAuth, requireStaffOrAdmin, [
  body('title').isLength({ min: 1 }).trim(),
  body('description').optional().trim(),
  body('startTime').isISO8601().toDate(),
  body('endTime').isISO8601().toDate()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { title, description, startTime, endTime } = req.body;
  const { userId } = req.session;

  // Validate that end time is after start time
  if (new Date(endTime) <= new Date(startTime)) {
    return res.status(400).json({ 
      message: 'End time must be after start time' 
    });
  }

  try {
    const result = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [title, description, startTime, endTime, userId]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating contest:', error);
    res.status(500).json({ message: 'Error creating contest' });
  }
});

// PUT /api/contests/:id - Update contest (Admin only)
router.put('/:id', requireAuth, requireStaffOrAdmin, [
  body('title').isLength({ min: 1 }).trim(),
  body('description').optional().trim(),
  body('startTime').isISO8601().toDate(),
  body('endTime').isISO8601().toDate()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { title, description, startTime, endTime } = req.body;

  // Validate that end time is after start time
  if (new Date(endTime) <= new Date(startTime)) {
    return res.status(400).json({ 
      message: 'End time must be after start time' 
    });
  }

  try {
    const result = await db.query(`
      UPDATE contests 
      SET title = $1, description = $2, start_time = $3, end_time = $4
      WHERE id = $5
      RETURNING *
    `, [title, description, startTime, endTime, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Contest not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error updating contest ${id}:`, error);
    res.status(500).json({ message: 'Error updating contest' });
  }
});

// DELETE /api/contests/:id - Delete contest (Admin only)
router.delete('/:id', requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if contest can be deleted (should not be running or finished with data)
    const contestResult = await db.query('SELECT * FROM contests WHERE id = $1', [id]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Contest not found' });
    }

    const contest = contestResult.rows[0];
    if (contest.status === 'running') {
      return res.status(400).json({ 
        message: 'Cannot delete a running contest' 
      });
    }

    // Move problems back to main system before deleting
    await db.query(
      'UPDATE problems SET contest_id = NULL WHERE contest_id = $1',
      [id]
    );

    const result = await db.query('DELETE FROM contests WHERE id = $1 RETURNING id', [id]);
    
    res.json({ message: `Contest ${id} deleted successfully` });
  } catch (error) {
    console.error(`Error deleting contest ${id}:`, error);
    res.status(500).json({ message: 'Error deleting contest' });
  }
});

// ==========================================
// PROBLEM MIGRATION ENDPOINTS (Admin only)
// ==========================================

// GET /api/admin/contests/:id/problems - Get problems in contest (Admin)
router.get('/:id/admin-problems', requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const problems = await problemMigration.getProblemsInContest(id);
    res.json(problems);
  } catch (error) {
    console.error(`Error fetching problems for contest ${id}:`, error);
    res.status(500).json({ message: 'Error fetching contest problems' });
  }
});


// POST /api/contests/:id/problems - Move problems to/from contest (Admin)
router.post('/:id/problems', requireAuth, requireStaffOrAdmin, [
  body('problemIds').isArray({ min: 1 }).withMessage('Must provide at least one problem ID'),
  body('problemIds.*').isString().trim().escape(),
  body('action').isIn(['move_to_contest', 'move_to_main']).withMessage('Action must be move_to_contest or move_to_main')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { problemIds, action } = req.body;

  try {
    let result;
    if (action === 'move_to_contest') {
      result = await problemMigration.moveProblemsToContest(parseInt(id), problemIds);
    } else if (action === 'move_to_main') {
      result = await problemMigration.moveProblemsBackToMain(parseInt(id), problemIds);
    }
    res.json(result);
  } catch (error) {
    console.error(`Error ${action} problems for contest ${id}:`, error);
    res.status(400).json({ message: error.message || `Error ${action} problems` });
  }
});

// DELETE /api/contests/:id/problems/:problemId - Move problem back to main system
router.delete('/:id/problems/:problemId', requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { id, problemId } = req.params;

  try {
    // Check if contest exists and is in correct status
    const contestResult = await db.query('SELECT * FROM contests WHERE id = $1', [id]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Contest not found' });
    }

    const contest = contestResult.rows[0];
    if (contest.status !== 'scheduled') {
      return res.status(400).json({ 
        message: 'Can only move problems from scheduled contests' 
      });
    }

    // Move single problem back to main system
    const updateResult = await db.query(
      'UPDATE problems SET contest_id = NULL WHERE id = $1 AND contest_id = $2 RETURNING id, title',
      [problemId, id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Problem not found in this contest' 
      });
    }

    res.json({ 
      message: `Successfully moved problem ${problemId} back to main system`,
      problem: updateResult.rows[0]
    });
  } catch (error) {
    console.error(`Error moving problem ${problemId} from contest ${id}:`, error);
    res.status(500).json({ message: 'Error moving problem from contest' });
  }
});

// GET /api/contests/:id/problems - Get contest problems for participants (User endpoint)
router.get('/:id/problems', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.session;
  
  try {
    // Check if contest exists
    const contestResult = await db.query('SELECT * FROM contests WHERE id = $1', [id]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Contest not found' });
    }

    const contest = contestResult.rows[0];
    
    // Check if user is a participant
    const participantResult = await db.query(
      'SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (participantResult.rows.length === 0) {
      return res.status(403).json({ message: 'You must join this contest to view problems' });
    }
    
    // Only show problems if contest is running, finishing, or finished
    if (!['running', 'finishing', 'finished'].includes(contest.status)) {
      return res.json([]); // Return empty array for scheduled contests
    }
    
    // Get problems in this contest
    let problemsResult;
    if (contest.status === 'finished') {
      // For finished contests, get problems from contest_problems snapshot
      problemsResult = await db.query(`
        SELECT problem_id as id, title, author, time_limit_ms, memory_limit_mb
        FROM contest_problems 
        WHERE contest_id = $1
        ORDER BY problem_id
      `, [id]);
    } else {
      // For running/finishing contests, get problems from problems table
      problemsResult = await db.query(`
        SELECT id, title, author, time_limit_ms, memory_limit_mb
        FROM problems 
        WHERE contest_id = $1
        ORDER BY id
      `, [id]);
    }
    
    res.json(problemsResult.rows);
  } catch (error) {
    console.error(`Error fetching contest problems for user ${userId}:`, error);
    res.status(500).json({ message: 'Error fetching contest problems' });
  }
});

module.exports = router; 