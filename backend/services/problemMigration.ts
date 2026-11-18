import * as db from '../db';
import { PoolClient } from 'pg';
import {
  CONTEST_STATUS,
  JUDGE_CONFIG,
  SUBMISSION_QUERY_CONFIG,
  SUBMISSION_STATUS,
} from '../constants';
import { logger } from '../utils/logger';
import { ContestRow } from '../types/models';
import { solveRewardXpSql } from './progressionService';
import { publishRealtime } from './realtimeHub';
import { enqueueTrackedJudgeTask, getContestInFlightCount, waitForContestJudgesToDrain } from './judgeQueue';
import { processSubmission } from './submissionService';
import {
  AvailableContestProblemRow,
  ContestMigrationResult,
  ContestProblemListRow,
  ContestStatusRow,
  ProblemContestCheckRow,
  ProblemIdentityRow,
  ProblemMoveResult,
} from '../types/service';
import { contestProblemOrderSql } from './contestProblemOrder';
import { contestStandingsCte } from './contestStandingsSql';

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
 * @param contestId - The contest ID to move problems to
 * @param problemIds - Array of problem IDs to move
 * @returns Result object with success status and details
 */
export const moveProblemsToContest = async (contestId: number, problemIds: string[]): Promise<ProblemMoveResult> => {
  const client: PoolClient = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Check if contest exists and is in correct status
    const contestResult = await client.query<ContestStatusRow>(
      'SELECT id, status FROM contests WHERE id = $1',
      [contestId]
    );

    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }

    const contest = contestResult.rows[0];
    if (contest.status !== CONTEST_STATUS.SCHEDULED && contest.status !== CONTEST_STATUS.RUNNING) {
      throw new Error('Can only move problems to scheduled or running contests');
    }

    // Check if all problems exist and are in main system (contest_id IS NULL)
    const problemsCheck = await client.query<ProblemContestCheckRow>(
      'SELECT id, title, contest_id FROM problems WHERE id = ANY($1)',
      [problemIds]
    );

    if (problemsCheck.rows.length !== problemIds.length) {
      throw new Error('Some problems not found');
    }

    const problemsInContest = problemsCheck.rows.filter((problem) => problem.contest_id !== null);
    if (problemsInContest.length > 0) {
      throw new Error(`Problems already in contest: ${problemsInContest.map((problem) => problem.id).join(', ')}`);
    }

    // Move problems to contest. XSYS-004: snapshot each problem's current
    // visibility so every exit path can restore exactly what was there
    // before, instead of force-publishing hidden problems (bulk move-back)
    // or leaving them invisible forever (single move-back, contest delete).
    const updateResult = await client.query<ProblemIdentityRow>(
      `UPDATE problems p
       SET contest_id = $1, is_visible = FALSE, is_visible_before_contest = p.is_visible,
           contest_position = base.last + o.ord
       FROM unnest($2::text[]) WITH ORDINALITY AS o(id, ord),
            (SELECT COALESCE(MAX(contest_position), 0) AS last FROM problems WHERE contest_id = $1) base
       WHERE p.id = o.id
       RETURNING p.id, p.title`,
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
    logger.error('failed to move problems to contest', { err: error });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Move problems from contest back to main system
 * @param contestId - The contest ID to move problems from
 * @param problemIds - Optional array of problem IDs to move. If null, all problems are moved.
 * @param outerClient - Run inside the caller's open transaction instead of a
 *   transaction of its own (the contest-end migration passes its client, so
 *   the move commits or rolls back together with the rest of the finish).
 * @returns Result object with success status and details
 */
export const moveProblemsBackToMain = async (
  contestId: number,
  problemIds: string[] | null = null,
  outerClient?: PoolClient,
): Promise<ProblemMoveResult> => {
  const client: PoolClient = outerClient ?? await db.pool.connect();

  try {
    if (!outerClient) await client.query('BEGIN');

    // Check if contest exists
    const contestResult = await client.query<ContestStatusRow>(
      'SELECT id, status FROM contests WHERE id = $1',
      [contestId]
    );

    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }

    // Build query dynamically. XSYS-004: restore the pre-contest visibility
    // snapshot (legacy rows without a snapshot fall back to visible, matching
    // the historical behavior) and clear the snapshot.
    let queryText = `
      UPDATE problems
      SET contest_id = NULL,
          contest_position = NULL,
          is_visible = COALESCE(is_visible_before_contest, TRUE),
          is_visible_before_contest = NULL
      WHERE contest_id = $1`;
    const queryParams: Array<number | string[]> = [contestId];

    if (problemIds && problemIds.length > 0) {
      queryText += ` AND id = ANY($2)`;
      queryParams.push(problemIds);
    }

    queryText += ' RETURNING id, title';

    const updateResult = await client.query<ProblemIdentityRow>(queryText, queryParams);

    if (!outerClient) await client.query('COMMIT');

    return {
      success: true,
      message: `Successfully moved ${updateResult.rows.length} problems back to main system`,
      movedProblems: updateResult.rows
    };

  } catch (error) {
    if (!outerClient) await client.query('ROLLBACK');
    logger.error('failed to move problems back to main', { err: error });
    throw error;
  } finally {
    if (!outerClient) client.release();
  }
};

export interface MigrateContestOptions {
  /**
   * Finish even though the contest's judges have not drained (the
   * scheduler's last resort once its deferral budget is spent). Every
   * migrated row that is not yet judged is re-judged in the practice pool.
   */
  proceedWithJudgesInFlight?: boolean;
}

/**
 * Migrate all contest submissions to main submissions table and generate final scoreboard
 * @param contestId - The contest ID to migrate submissions from
 * @returns Result object with migration details. `deferred: true` means the
 *   contest's judges had not drained, nothing was written and the contest
 *   stays 'finishing' for a later attempt.
 */
export const migrateSubmissionsAfterContest = async (
  contestId: number,
  { proceedWithJudgesInFlight = false }: MigrateContestOptions = {},
): Promise<ContestMigrationResult> => {
  // JUDGE-005 / XSYS-001/002 / A5-02: contest_submissions rows are DELETED
  // below. A judge still queued or running for this contest would then find
  // no row (or its final UPDATE would hit zero rows) and the verdict would be
  // lost: the migrated copy in `submissions` would stay pre-verdict and the
  // frozen final scoreboard would count it as 0. So drain the contest's
  // judges first, bounded by CONTEST_MIGRATION_DRAIN_TIMEOUT_MS so a tick
  // never hangs. Not drained: write nothing and report `deferred` — the
  // contest stays 'finishing' (submissions are already closed by the
  // wall-clock gate) and the scheduler tries again next tick. The drain runs
  // before a pool client is taken, so no transaction idles while waiting.
  const drained = await waitForContestJudgesToDrain(
    contestId,
    JUDGE_CONFIG.CONTEST_MIGRATION_DRAIN_TIMEOUT_MS
  );
  if (!drained && !proceedWithJudgesInFlight) {
    logger.warn('contest migration deferred - contest judges still in flight', {
      contestId,
      inFlight: getContestInFlightCount(contestId),
    });
    return {
      success: false,
      deferred: true,
      message: 'Contest judges are still running; migration deferred',
      migratedSubmissions: 0,
      finalScoreboard: 0,
    };
  }
  if (!drained) {
    logger.warn('contest migration proceeding with judges still in flight - unjudged submissions will be re-judged after the move', {
      contestId,
      inFlight: getContestInFlightCount(contestId),
    });
  }

  const client: PoolClient = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Check if contest exists and is finished
    const contestResult = await client.query<ContestStatusRow>(
      'SELECT id, status FROM contests WHERE id = $1',
      [contestId]
    );

    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }

    const contest = contestResult.rows[0];
    if (contest.status !== CONTEST_STATUS.FINISHING) {
      throw new Error('Contest must be in finishing status to migrate submissions');
    }

    // First, save the problems snapshot for this contest
    await client.query(`
      INSERT INTO contest_problems (contest_id, problem_id, title, author, time_limit_ms, memory_limit_mb, position)
      SELECT $1, id, title, author, time_limit_ms, memory_limit_mb, contest_position
      FROM problems
      WHERE contest_id = $1
      ON CONFLICT (contest_id, problem_id) DO NOTHING
    `, [contestId]);

    // Generate final scoreboard and store it.
    //
    // CONTEST-007: source from contest_participants (not the submission
    // aggregate), so participants who never submitted still get a row with
    // zero — matching the live scoreboard, which lists every participant.
    //
    // CONTEST-008: detailed_scores uses the live scoreboard's shape
    // ({problemId: {score}}) rather than the historical bare-number map, so
    // both variants parse identically client-side.
    const scoreboardResult = await client.query(`
      ${contestStandingsCte('$1', { withStatuses: true })}
      INSERT INTO contest_scoreboards (contest_id, user_id, total_score, detailed_scores, last_score_improvement_time)
      SELECT $1, user_id, total_score, detailed_scores, last_score_improvement_time
      FROM standings
      RETURNING *
    `, [contestId]);

    // Migrate all contest submissions to main submissions table. A row
    // that is not judged yet (only possible when finishing with judges in
    // flight) lands as Pending, so it is re-judged below and a restart's
    // sweep re-enqueues it instead of marking it System Error.
    const migrationResult = await client.query<{ id: number; overall_status: string }>(`
      INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results, max_time_ms, max_memory_kb, submitted_at)
      SELECT user_id, problem_id, code, language,
             CASE WHEN overall_status IN ($2, $3) THEN $4 ELSE overall_status END,
             score, results, max_time_ms, max_memory_kb, submitted_at
      FROM contest_submissions
      WHERE contest_id = $1
      RETURNING id, overall_status
    `, [contestId, SUBMISSION_STATUS.COMPILING, SUBMISSION_STATUS.RUNNING, SUBMISSION_STATUS.PENDING]);
    // Migrated rows that still need a verdict, re-enqueued after COMMIT.
    const unjudgedIds = migrationResult.rows
      .filter((row) => row.overall_status === SUBMISSION_STATUS.PENDING)
      .map((row) => row.id);

    // SCORE-002/DB-03: award XP for the migrated Accepted solves, inside the
    // same transaction. Idempotent like awardSolveReward (unique constraint
    // on (user_id, problem_id), ON CONFLICT DO NOTHING), so pairs the live
    // judge pipeline already rewarded during the contest are left untouched
    // and re-running a migration can never double-award. Mirrors the live
    // pipeline's condition: Accepted with a full score.
    await client.query(`
      INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, difficulty_snapshot, awarded_at)
      SELECT DISTINCT ON (cs.user_id, cs.problem_id)
             cs.user_id, cs.problem_id,
             ${solveRewardXpSql},
             p.difficulty,
             cs.submitted_at
      FROM contest_submissions cs
      JOIN problems p ON p.id = cs.problem_id
      WHERE cs.contest_id = $1
        AND cs.overall_status = $2
        AND cs.score >= $3
        AND cs.user_id IS NOT NULL
      ON CONFLICT (user_id, problem_id) DO NOTHING
    `, [contestId, SUBMISSION_STATUS.ACCEPTED, SUBMISSION_QUERY_CONFIG.FULL_PROBLEM_SCORE]);

    // Clean up contest submissions (optional - could keep for historical data)
    await client.query(
      'DELETE FROM contest_submissions WHERE contest_id = $1',
      [contestId]
    );

    // Move problems back to main system, in this same transaction
    await moveProblemsBackToMain(contestId, null, client);

    // Update contest status to finished
    await client.query(
      'UPDATE contests SET status = $1 WHERE id = $2',
      [CONTEST_STATUS.FINISHED, contestId]
    );

    await client.query('COMMIT');

    // A5-02: nothing migrated may stay unjudged. The contest judge of such a
    // row (if any is still alive) finds its contest_submissions row gone and
    // steps aside; the practice-pool copy gets its verdict here instead. The
    // frozen final scoreboard above keeps the score the row had at finish.
    for (const submissionId of unjudgedIds) {
      enqueueTrackedJudgeTask(() => processSubmission(submissionId), { table: 'submissions', submissionId });
    }
    if (unjudgedIds.length > 0) {
      logger.warn('re-queued unjudged contest submissions after migration', {
        contestId,
        count: unjudgedIds.length,
      });
    }

    // The final scoreboard rewrite is visible to connected clients — ping
    // them to refetch (publishRealtime never throws).
    publishRealtime({ type: 'scoreboard_update', contestId });

    return {
      success: true,
      message: 'Contest migration completed successfully',
      migratedSubmissions: migrationResult.rows.length,
      finalScoreboard: scoreboardResult.rows.length
    };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('failed to migrate contest submissions', { err: error });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get problems available for moving to contest (problems in main system)
 * @returns Array of available problems
 */
export const getAvailableProblemsForContest = async (): Promise<AvailableContestProblemRow[]> => {
  try {
    const result = await db.query<AvailableContestProblemRow>(`
      SELECT id, title, author, is_visible
      FROM problems 
      WHERE contest_id IS NULL
      ORDER BY id
    `);
    return result.rows;
  } catch (error) {
    logger.error('failed to fetch available problems', { err: error });
    throw error;
  }
};

/**
 * Get problems currently in a contest
 * @param contestId - The contest ID
 * @returns Array of problems in the contest
 */
export const getProblemsInContest = async (contestId: number): Promise<ContestProblemListRow[]> => {
  try {
    // First check contest status
    const contestResult = await db.query<Pick<ContestRow, 'status'>>(
      'SELECT status FROM contests WHERE id = $1',
      [contestId]
    );

    if (contestResult.rows.length === 0) {
      throw new Error('Contest not found');
    }

    const contest = contestResult.rows[0];

    if (contest.status === CONTEST_STATUS.FINISHED) {
      // For finished contests, get problems from contest_problems snapshot
      const result = await db.query<ContestProblemListRow>(`
        SELECT problem_id as id, title, author
        FROM contest_problems 
        WHERE contest_id = $1
        ORDER BY ${contestProblemOrderSql('contest_problems', 'position')}
      `, [contestId]);
      return result.rows;
    } else {
      // For non-finished contests, get problems from problems table
      const result = await db.query<ContestProblemListRow>(`
        SELECT id, title, author
        FROM problems 
        WHERE contest_id = $1
        ORDER BY ${contestProblemOrderSql('problems', 'contest_position')}
      `, [contestId]);
      return result.rows;
    }
  } catch (error) {
    logger.error('failed to fetch contest problems', { err: error });
    throw error;
  }
};
