const db = require('../db');

/**
 * Problem Migration Service
 * 
 * This service handles the movement of problems between the main system and contests.
 * Key functions:
 * - moveProblemsToContest: Move problems from main system to a contest
 * - moveProblemsBackToMain: Move problems from contest back to main system
 * - migrateSubmissionsAfterContest: Migrate contest submissions to main submissions
 */

/**
 * Move problems from main system to a contest
 * @param {number} contestId - The contest ID to move problems to
 * @param {string[]} problemIds - Array of problem IDs to move
 * @returns {Promise<Object>} Result object with success status and details
 */
const moveProblemsToContest = async (contestId, problemIds) => {
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if contest exists and is in correct status
    const contestResult = await client.query(
      'SELECT * FROM contests WHERE id = $1',
      [contestId]
    );
    
    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }
    
    const contest = contestResult.rows[0];
    if (contest.status !== 'scheduled' && contest.status !== 'running') {
      throw new Error('Can only move problems to scheduled or running contests');
    }
    
    // Check if all problems exist and are in main system (contest_id IS NULL)
    const problemsCheck = await client.query(
      'SELECT id, title, contest_id FROM problems WHERE id = ANY($1)',
      [problemIds]
    );
    
    if (problemsCheck.rows.length !== problemIds.length) {
      throw new Error('Some problems not found');
    }
    
    const problemsInContest = problemsCheck.rows.filter(p => p.contest_id !== null);
    if (problemsInContest.length > 0) {
      throw new Error(`Problems already in contest: ${problemsInContest.map(p => p.id).join(', ')}`);
    }
    
    // Move problems to contest
    const updateResult = await client.query(
      'UPDATE problems SET contest_id = $1, is_visible = FALSE WHERE id = ANY($2) RETURNING id, title',
      [contestId, problemIds]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      message: `Successfully moved ${updateResult.rows.length} problems to contest`,
      movedProblems: updateResult.rows
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error moving problems to contest:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Move problems from contest back to main system
 * @param {number} contestId - The contest ID to move problems from
 * @param {string[]} [problemIds=null] - Optional array of problem IDs to move. If null, all problems are moved.
 * @returns {Promise<Object>} Result object with success status and details
 */
const moveProblemsBackToMain = async (contestId, problemIds = null) => {
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if contest exists
    const contestResult = await client.query(
      'SELECT * FROM contests WHERE id = $1',
      [contestId]
    );
    
    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }
    
    // Build query dynamically
    let queryText = 'UPDATE problems SET contest_id = NULL, is_visible = TRUE WHERE contest_id = $1';
    const queryParams = [contestId];

    if (problemIds && problemIds.length > 0) {
      queryText += ` AND id = ANY($2)`;
      queryParams.push(problemIds);
    }
    
    queryText += ' RETURNING id, title';

    const updateResult = await client.query(queryText, queryParams);
    
    await client.query('COMMIT');
    
    return {
      success: true,
      message: `Successfully moved ${updateResult.rows.length} problems back to main system`,
      movedProblems: updateResult.rows
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error moving problems back to main:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Migrate all contest submissions to main submissions table and generate final scoreboard
 * @param {number} contestId - The contest ID to migrate submissions from
 * @returns {Promise<Object>} Result object with migration details
 */
const migrateSubmissionsAfterContest = async (contestId) => {
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if contest exists and is finished
    const contestResult = await client.query(
      'SELECT * FROM contests WHERE id = $1',
      [contestId]
    );
    
    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }
    
    const contest = contestResult.rows[0];
    if (contest.status !== 'finishing') {
      throw new Error('Contest must be in finishing status to migrate submissions');
    }
    
    // First, save the problems snapshot for this contest
    await client.query(`
      INSERT INTO contest_problems (contest_id, problem_id, title, author, time_limit_ms, memory_limit_mb)
      SELECT $1, id, title, author, time_limit_ms, memory_limit_mb
      FROM problems
      WHERE contest_id = $1
      ON CONFLICT (contest_id, problem_id) DO NOTHING
    `, [contestId]);
    
    // Generate final scoreboard and store it
    const scoreboardResult = await client.query(`
      WITH UserBestScores AS (
        SELECT
          cs.user_id,
          cs.problem_id,
          MAX(cs.score) AS best_score
        FROM contest_submissions cs
        WHERE cs.contest_id = $1
        GROUP BY cs.user_id, cs.problem_id
      ),
      UserTotalScores AS (
        SELECT
          ubs.user_id,
          SUM(ubs.best_score) AS total_score,
          jsonb_object_agg(ubs.problem_id, ubs.best_score) AS detailed_scores
        FROM UserBestScores ubs
        GROUP BY ubs.user_id
      )
      INSERT INTO contest_scoreboards (contest_id, user_id, total_score, detailed_scores)
      SELECT $1, uts.user_id, uts.total_score, uts.detailed_scores
      FROM UserTotalScores uts
      JOIN contest_participants cp ON cp.user_id = uts.user_id AND cp.contest_id = $1
      RETURNING *
    `, [contestId]);
    
    // Migrate all contest submissions to main submissions table
    const migrationResult = await client.query(`
      INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results, max_time_ms, max_memory_kb, submitted_at)
      SELECT user_id, problem_id, code, language, overall_status, score, results, max_time_ms, max_memory_kb, submitted_at
      FROM contest_submissions
      WHERE contest_id = $1
      RETURNING id
    `, [contestId]);
    
    // Clean up contest submissions (optional - could keep for historical data)
    await client.query(
      'DELETE FROM contest_submissions WHERE contest_id = $1',
      [contestId]
    );
    
    // Move problems back to main system
    await moveProblemsBackToMain(contestId);
    
    // Update contest status to finished
    await client.query(
      'UPDATE contests SET status = $1 WHERE id = $2',
      ['finished', contestId]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      message: 'Contest migration completed successfully',
      migratedSubmissions: migrationResult.rows.length,
      finalScoreboard: scoreboardResult.rows.length
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error migrating contest submissions:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get problems available for moving to contest (problems in main system)
 * @returns {Promise<Array>} Array of available problems
 */
const getAvailableProblemsForContest = async () => {
  try {
    const result = await db.query(`
      SELECT id, title, author, is_visible
      FROM problems 
      WHERE contest_id IS NULL
      ORDER BY id
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching available problems:', error);
    throw error;
  }
};

/**
 * Get problems currently in a contest
 * @param {number} contestId - The contest ID
 * @returns {Promise<Array>} Array of problems in the contest
 */
const getProblemsInContest = async (contestId) => {
  try {
    // First check contest status
    const contestResult = await db.query(
      'SELECT status FROM contests WHERE id = $1',
      [contestId]
    );
    
    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }
    
    const contest = contestResult.rows[0];
    
    if (contest.status === 'finished') {
      // For finished contests, get problems from contest_problems snapshot
      const result = await db.query(`
        SELECT problem_id as id, title, author
        FROM contest_problems 
        WHERE contest_id = $1
        ORDER BY problem_id
      `, [contestId]);
      return result.rows;
    } else {
      // For non-finished contests, get problems from problems table
      const result = await db.query(`
        SELECT id, title, author
        FROM problems 
        WHERE contest_id = $1
        ORDER BY id
      `, [contestId]);
      return result.rows;
    }
  } catch (error) {
    console.error('Error fetching contest problems:', error);
    throw error;
  }
};

module.exports = {
  moveProblemsToContest,
  moveProblemsBackToMain,
  migrateSubmissionsAfterContest,
  getAvailableProblemsForContest,
  getProblemsInContest
}; 