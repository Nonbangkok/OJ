import * as db from '../db';
import { ACTIVE_CONTEST_STATUSES, ProblemRow } from '../types/models';
import { CONTEST_STATUS } from '../constants';
import {
    getContestById,
    isContestManagementRole,
    isContestParticipant,
} from './contestAccess';
import {
    ContestProblemDetailRow,
    ContestProblemDetailResult,
    ContestProblemPdfResult,
    ContestProblemsForParticipantResult,
    ContestProblemStatsRow,
} from '../types/service';

/**
 * Contestant-facing contest problem access, split out of contestQueryService.
 *
 * Every function follows the same guard sequence:
 * contest exists (and is visible to the viewer) -> user is a participant
 * -> contest is active -> read from `problems` (running) or the
 * `contest_problems` snapshot (finished). The shared lookups live in
 * contestAccess.
 */

export const getContestProblemsForParticipant = async (
    contestId: string,
    userId: number,
    viewer?: { id: number; role: string },
): Promise<ContestProblemsForParticipantResult> => {
    const contest = await getContestById(contestId);
    if (!contest) {
        return { kind: 'not_found' };
    }

    // Hidden contests read as not-found for normal users; staff/admin
    // (e.g. inspecting via direct URL) keep access.
    if (!contest.is_visible && !isContestManagementRole(viewer)) {
        return { kind: 'not_found' };
    }

    if (!(await isContestParticipant(contestId, userId))) {
        return { kind: 'not_participant' };
    }

    if (!ACTIVE_CONTEST_STATUSES.includes(contest.status)) {
        return { kind: 'inactive', data: [] };
    }

    const baseQuery = `
      WITH RankedSubmissions AS (
        SELECT
          cs.id, cs.user_id, cs.problem_id, cs.score, cs.overall_status,
          cs.results, cs.submitted_at,
          ROW_NUMBER() OVER(PARTITION BY cs.user_id, cs.problem_id ORDER BY cs.score DESC, cs.id DESC) as rn_best,
          ROW_NUMBER() OVER(PARTITION BY cs.user_id, cs.problem_id ORDER BY cs.id DESC) as rn_latest
        FROM contest_submissions cs
        WHERE cs.user_id = $1 AND cs.contest_id = $2
      ),
      UserProblemStats AS (
        SELECT
          problem_id,
          MAX(score) AS best_score,
          COUNT(*) AS submission_count
        FROM contest_submissions
        WHERE user_id = $1 AND contest_id = $2
        GROUP BY problem_id
      )
    `;

    if (contest.status === CONTEST_STATUS.FINISHED) {
        const result = await db.query<ContestProblemStatsRow>(
            baseQuery + `
            SELECT
              cp.problem_id as id, cp.title, cp.author,
              ups.best_score, ups.submission_count,
              latest.submitted_at AS latest_submission_at,
              latest.overall_status AS latest_submission_status,
              best.overall_status AS best_submission_status,
              best.results AS best_submission_results
            FROM contest_problems cp
            LEFT JOIN UserProblemStats ups ON cp.problem_id = ups.problem_id
            LEFT JOIN RankedSubmissions latest ON cp.problem_id = latest.problem_id AND latest.rn_latest = 1
            LEFT JOIN RankedSubmissions best ON cp.problem_id = best.problem_id AND best.rn_best = 1
            WHERE cp.contest_id = $2
            ORDER BY cp.problem_id
        `,
            [userId, contestId],
        );
        return { kind: 'ok', data: result.rows };
    }

    const result = await db.query<ContestProblemStatsRow>(
        baseQuery + `
        SELECT
          p.id, p.title, p.author, p.time_limit_ms, p.memory_limit_mb,
          ups.best_score, ups.submission_count,
          latest.submitted_at AS latest_submission_at,
          latest.overall_status AS latest_submission_status,
          best.overall_status AS best_submission_status,
          best.results AS best_submission_results
        FROM problems p
        LEFT JOIN UserProblemStats ups ON p.id = ups.problem_id
        LEFT JOIN RankedSubmissions latest ON p.id = latest.problem_id AND latest.rn_latest = 1
        LEFT JOIN RankedSubmissions best ON p.id = best.problem_id AND best.rn_best = 1
        WHERE p.contest_id = $2
        ORDER BY p.id
      `,
        [userId, contestId],
    );
    return { kind: 'ok', data: result.rows };
};

export const getContestProblemDetailForParticipant = async (
    contestId: string,
    problemId: string,
    userId: number,
    viewer?: { id: number; role: string },
): Promise<ContestProblemDetailResult> => {
    const contest = await getContestById(contestId);
    if (!contest || (!contest.is_visible && !isContestManagementRole(viewer))) {
        return { kind: 'not_found_contest' };
    }
    const contestStatus = contest.status;

    if (!ACTIVE_CONTEST_STATUSES.includes(contestStatus)) {
        return { kind: 'inactive' };
    }

    if (!(await isContestParticipant(contestId, userId))) {
        return { kind: 'not_participant' };
    }

    if (contestStatus === CONTEST_STATUS.FINISHED) {
        const result = await db.query<ContestProblemDetailRow>(
            'SELECT problem_id AS id, title, author, time_limit_ms, memory_limit_mb, (problem_pdf IS NOT NULL) AS has_pdf FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
            [contestId, problemId],
        );
        if (!result.rows[0]) {
            return { kind: 'not_found_problem' };
        }
        return { kind: 'ok', data: result.rows[0] };
    }

    const result = await db.query<ContestProblemDetailRow>(
        'SELECT id, title, author, time_limit_ms, memory_limit_mb, (problem_pdf IS NOT NULL) AS has_pdf FROM problems WHERE id = $1 AND contest_id = $2',
        [problemId, contestId],
    );
    if (!result.rows[0]) {
        return { kind: 'not_found_problem' };
    }
    return { kind: 'ok', data: result.rows[0] };
};

export const getContestProblemPdfForParticipant = async (
    contestId: string,
    problemId: string,
    userId: number,
    viewer?: { id: number; role: string },
): Promise<ContestProblemPdfResult> => {
    const contest = await getContestById(contestId);
    if (!contest || (!contest.is_visible && !isContestManagementRole(viewer))) {
        return { kind: 'not_found_contest' };
    }
    const contestStatus = contest.status;

    if (!ACTIVE_CONTEST_STATUSES.includes(contestStatus)) {
        return { kind: 'inactive' };
    }

    if (!(await isContestParticipant(contestId, userId))) {
        return { kind: 'not_participant' };
    }

    const queryText = contestStatus === CONTEST_STATUS.FINISHED
        ? 'SELECT problem_pdf FROM contest_problems WHERE contest_id = $1 AND problem_id = $2'
        : 'SELECT problem_pdf FROM problems WHERE id = $1 AND contest_id = $2';
    const queryParams = contestStatus === CONTEST_STATUS.FINISHED
        ? [contestId, problemId]
        : [problemId, contestId];

    const result = await db.query<{ problem_pdf: Buffer | null }>(queryText, queryParams);
    const pdf = result.rows[0]?.problem_pdf ?? null;
    if (!pdf) {
        return { kind: 'not_found_pdf' };
    }
    return { kind: 'ok', data: pdf };
};
