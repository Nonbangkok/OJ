import * as db from '../db';
import { SUBMISSION_STATUS } from '../constants';
import { enqueueTrackedJudgeTask, isSubmissionInFlight } from './judgeQueue';
import { processContestSubmission, processSubmission } from './submissionService';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

export interface RejudgeResult {
    /** Submissions accepted for rejudge (reset + enqueued). */
    queued: number;
    /** Non-judgeable rows (currently: rows whose stored code is empty). */
    skipped: number;
    /** Rows skipped because a judge is already in flight for them (JUDGE-004). */
    busy: number;
}

/** Rejudge batches larger than this are logged as a warning (never blocked);
 *  the judge queue throttles execution regardless of batch size. */
const LARGE_REJUDGE_WARN_THRESHOLD = 500;

/** A row is judgeable only when it still carries source code to re-run. */
const JUDGEABLE_CODE_CONDITION = "COALESCE(code, '') <> ''";

type JudgeScope = 'problem' | 'contest';

interface PoolPlan {
    /** Which submissions table this pool reads/resets. */
    table: 'submissions' | 'contest_submissions';
    /** Column the reset filters on, plus its bound parameter. */
    filterColumn: 'problem_id' | 'contest_id';
    filterValue: string | number;
}

interface PoolOutcome {
    /** Reset rows: id, plus contest_id for contest-pool rows (else null). */
    rows: { id: number; contest_id: number | null }[];
    skipped: number;
    /** Judgeable rows left untouched because their judge is still in flight. */
    busy: number;
}

/**
 * Per-scope rejudge debounce (JUDGE-004). A second identical rejudge while
 * the first is still working would reset rows back to Pending under a
 * running judge (racing verdict writers) and double the queue, so an
 * in-progress rejudge for the same problem/contest is rejected with 409.
 */
const rejudgeInProgress = new Set<string>();

/** Run `work` unless a rejudge for the same scope key is already running. */
const withRejudgeLock = async <T>(scopeKey: string, work: () => Promise<T>): Promise<T> => {
    if (rejudgeInProgress.has(scopeKey)) {
        throw new AppError('A rejudge for this target is already in progress. Wait for it to finish.', 409);
    }
    rejudgeInProgress.add(scopeKey);
    try {
        return await work();
    } finally {
        rejudgeInProgress.delete(scopeKey);
    }
};

/** Reset one pool's judgeable, idle rows to Pending so they can be enqueued
 *  through the same judge-queue path a fresh submission takes. Rows with
 *  empty stored code are counted as skipped, and rows whose judge is still in
 *  flight as busy; both are left untouched. */
const rejudgePool = async (plan: PoolPlan): Promise<PoolOutcome> => {
    // Counted first so the reset is the last await before the caller enqueues
    // the reset rows (keeps the reset-to-enqueue gap to one round trip).
    const skipResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM ${plan.table}
         WHERE ${plan.filterColumn} = $1 AND NOT (${JUDGEABLE_CODE_CONDITION})`,
        [plan.filterValue]
    );

    // contest_id is returned alongside the id so contest-pool rows can be
    // tracked under their contest in the judge queue's in-flight accounting
    // (JUDGE-005); the standalone pool has no contest_id column, hence the
    // NULL-typed union instead of SELECT *.
    const contestIdColumn = plan.table === 'contest_submissions' ? 'contest_id' : 'NULL::integer AS contest_id';
    const candidates = await db.query<{ id: number; contest_id: number | null }>(
        `SELECT id, ${contestIdColumn} FROM ${plan.table}
         WHERE ${plan.filterColumn} = $1 AND ${JUDGEABLE_CODE_CONDITION}`,
        [plan.filterValue]
    );

    // In-flight guard, part 1 (JUDGE-004): a running pipeline (including one
    // that has written its verdict but not yet released its in-flight key)
    // owns its row. Resetting it would wipe a fresh verdict that nothing
    // re-queues. This check and the UPDATE dispatch run in the same
    // synchronous turn, so no row can go in flight between the two. A row can
    // still go in flight while the UPDATE is on the wire; runRejudge's
    // re-check right before enqueue (part 2) keeps that row from being queued
    // a second time.
    const idleIds = candidates.rows
        .filter((row) => !isSubmissionInFlight({ table: plan.table, submissionId: row.id }))
        .map((row) => row.id);
    const busy = candidates.rows.length - idleIds.length;

    const resetResult = idleIds.length === 0
        ? { rows: [] as { id: number; contest_id: number | null }[] }
        : await db.query<{ id: number; contest_id: number | null }>(
            `UPDATE ${plan.table}
             SET overall_status = $1, results = NULL
             WHERE id = ANY($2::int[]) AND ${JUDGEABLE_CODE_CONDITION}
             RETURNING id, ${contestIdColumn}`,
            [SUBMISSION_STATUS.PENDING, idleIds]
        );

    return {
        rows: resetResult.rows,
        skipped: Number(skipResult.rows[0]?.count ?? 0),
        busy,
    };
};

/** Shared driver: reset every pool, enqueue the reset rows, log the outcome.
 *  Rows whose judge is already in flight are not enqueued again and are
 *  counted as `busy` (JUDGE-004). A row in flight before the reset is not
 *  reset either; one that goes in flight during the reset is reset but not
 *  re-queued. */
const runRejudge = async (
    scope: JudgeScope,
    target: { problemId?: string; contestId?: number },
    pools: PoolPlan[]
): Promise<RejudgeResult> => {
    const scopeKey = target.problemId ?? String(target.contestId);
    return withRejudgeLock(scopeKey, async () => {
        logger.info('rejudge started', { scope, ...target });

        let queued = 0;
        let skipped = 0;
        let busy = 0;
        for (const pool of pools) {
            const outcome = await rejudgePool(pool);
            skipped += outcome.skipped;
            busy += outcome.busy;
            for (const row of outcome.rows) {
                const isContestPool = pool.table === 'contest_submissions';
                // In-flight guard, part 2 (JUDGE-004): the row may have gone in
                // flight while the reset was on the wire (a fresh submit's
                // controller, or a rejudge of an overlapping scope such as its
                // contest and its problem). Nothing is awaited between this
                // check and the enqueue, so the row is never queued twice. The
                // judge that already has it writes its verdict over the reset
                // (Pending is a judgeable state). Only if that judge wrote its
                // verdict while the reset was on the wire does the row stay
                // Pending, until the next rejudge or the boot sweep queues it.
                if (isSubmissionInFlight({ table: pool.table, submissionId: row.id })) {
                    busy += 1;
                    continue;
                }
                queued += 1;
                // The identical dispatch the submission controller performs: the
                // judge queue's MAX_CONCURRENT_JUDGES gate bounds this burst.
                enqueueTrackedJudgeTask(
                    () => (isContestPool ? processContestSubmission(row.id) : processSubmission(row.id)),
                    { table: pool.table, submissionId: row.id },
                    isContestPool ? row.contest_id ?? undefined : undefined
                );
            }
        }

        if (queued > LARGE_REJUDGE_WARN_THRESHOLD) {
            logger.warn('large rejudge batch queued', { scope, ...target, queued });
        }

        logger.info('rejudge completed', { scope, ...target, queued, skipped, busy });
        return { queued, skipped, busy };
    });
};

/**
 * Re-run every judgeable submission for a problem — both the standalone
 * `submissions` pool and any `contest_submissions` rows referencing the same
 * problem — against the current testcases and limits.
 */
export const rejudgeProblem = async (problemId: string): Promise<RejudgeResult> => {
    return runRejudge('problem', { problemId }, [
        { table: 'submissions', filterColumn: 'problem_id', filterValue: problemId },
        { table: 'contest_submissions', filterColumn: 'problem_id', filterValue: problemId },
    ]);
};

/**
 * Re-run every judgeable contest submission for a contest. Callers are
 * expected to reject finished contests (frozen scoreboard) beforehand.
 */
export const rejudgeContest = async (contestId: number): Promise<RejudgeResult> => {
    return runRejudge('contest', { contestId }, [
        { table: 'contest_submissions', filterColumn: 'contest_id', filterValue: contestId },
    ]);
};
