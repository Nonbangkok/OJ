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

/** Reset one pool's judgeable rows to Pending and enqueue them through the
 *  same judge-queue path a fresh submission takes. Rows with empty stored
 *  code are counted as skipped and left untouched. */
const rejudgePool = async (plan: PoolPlan): Promise<PoolOutcome> => {
    // contest_id is returned alongside the id so contest-pool rows can be
    // tracked under their contest in the judge queue's in-flight accounting
    // (JUDGE-005); the standalone pool has no contest_id column, hence the
    // NULL-typed union instead of SELECT *.
    const resetResult = await db.query<{ id: number; contest_id: number | null }>(
        `UPDATE ${plan.table}
         SET overall_status = $1, results = NULL
         WHERE ${plan.filterColumn} = $2 AND ${JUDGEABLE_CODE_CONDITION}
         RETURNING id${plan.table === 'contest_submissions' ? ', contest_id' : ', NULL::integer AS contest_id'}`,
        [SUBMISSION_STATUS.PENDING, plan.filterValue]
    );

    const skipResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM ${plan.table}
         WHERE ${plan.filterColumn} = $1 AND NOT (${JUDGEABLE_CODE_CONDITION})`,
        [plan.filterValue]
    );

    return {
        rows: resetResult.rows,
        skipped: Number(skipResult.rows[0]?.count ?? 0),
    };
};

/** Shared driver: reset every pool, enqueue the survivors, log the outcome.
 *  Rows whose judge is already in flight are left untouched and counted as
 *  `busy` — resetting them would race two judges over one row and the last
 *  writer would silently win (JUDGE-004). */
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
            for (const row of outcome.rows) {
                const isContestPool = pool.table === 'contest_submissions';
                // In-flight guard (JUDGE-004): skip rows the judge is already
                // processing — their running pipeline will deliver a verdict
                // against the same current testcases/limits anyway.
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
