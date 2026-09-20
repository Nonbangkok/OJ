import * as db from '../db';
import { IdRow } from '../types/service';
import { SUBMISSION_STATUS } from '../constants';
import { enqueueJudgeTask } from './judgeQueue';
import { processContestSubmission, processSubmission } from './submissionService';
import { logger } from '../utils/logger';

export interface RejudgeResult {
    /** Submissions accepted for rejudge (reset + enqueued). */
    queued: number;
    /** Non-judgeable rows (currently: rows whose stored code is empty). */
    skipped: number;
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
    ids: number[];
    skipped: number;
}

/** Reset one pool's judgeable rows to Pending and enqueue them through the
 *  same judge-queue path a fresh submission takes. Rows with empty stored
 *  code are counted as skipped and left untouched. */
const rejudgePool = async (plan: PoolPlan): Promise<PoolOutcome> => {
    const resetResult = await db.query<IdRow>(
        `UPDATE ${plan.table}
         SET overall_status = $1, results = NULL
         WHERE ${plan.filterColumn} = $2 AND ${JUDGEABLE_CODE_CONDITION}
         RETURNING id`,
        [SUBMISSION_STATUS.PENDING, plan.filterValue]
    );

    const skipResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM ${plan.table}
         WHERE ${plan.filterColumn} = $1 AND NOT (${JUDGEABLE_CODE_CONDITION})`,
        [plan.filterValue]
    );

    return {
        ids: resetResult.rows.map((row) => row.id),
        skipped: Number(skipResult.rows[0]?.count ?? 0),
    };
};

/** Shared driver: reset every pool, enqueue the survivors, log the outcome. */
const runRejudge = async (
    scope: JudgeScope,
    target: { problemId?: string; contestId?: number },
    pools: PoolPlan[]
): Promise<RejudgeResult> => {
    logger.info('rejudge started', { scope, ...target });

    let queued = 0;
    let skipped = 0;
    for (const pool of pools) {
        const outcome = await rejudgePool(pool);
        queued += outcome.ids.length;
        skipped += outcome.skipped;
        for (const id of outcome.ids) {
            const isContestPool = pool.table === 'contest_submissions';
            // The identical dispatch the submission controller performs: the
            // judge queue's MAX_CONCURRENT_JUDGES gate bounds this burst.
            enqueueJudgeTask(() =>
                isContestPool ? processContestSubmission(id) : processSubmission(id)
            );
        }
    }

    if (queued > LARGE_REJUDGE_WARN_THRESHOLD) {
        logger.warn('large rejudge batch queued', { scope, ...target, queued });
    }

    logger.info('rejudge completed', { scope, ...target, queued, skipped });
    return { queued, skipped };
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
