import * as db from '../db';
import { ACTIVE_CONTEST_STATUSES, ProblemRow } from '../types/models';
import { CONTEST_STATUS } from '../constants';
import { getProblemFiles } from './problemFilesService';
import {
    getContestById,
    isContestManagementRole,
    isContestParticipant,
} from './contestAccess';
import {
    ContestProblemDetailRow,
    ContestProblemDetailResult,
    ContestProblemPdfResult,
    ContestProblemStarterResult,
    ContestProblemsForParticipantResult,
    ContestProblemStatsRow,
} from '../types/service';
import { contestProblemOrderSql } from './contestProblemOrder';
import { contestSubmissionsSql } from './contestSubmissionsSql';
import { ProblemViewerStats, ProblemViewerStatsRow, toProblemViewerStats } from './problemViewerStats';

/**
 * Contestant-facing contest problem access, split out of contestQueryService.
 *
 * Every function follows the same guard sequence:
 * contest exists (and is visible to the viewer) -> user is a participant
 * -> contest is active -> read from `problems` (running) or the
 * `contest_problems` snapshot (finished). The shared lookups live in
 * contestAccess.
 *
 * The finish snapshot keeps titles, authors and limits only. The statement
 * PDF and the starter files of a finished contest come from the live
 * `problems` row, so they follow the problem's current gate: once the problem
 * has been attached to another contest, non-staff viewers of the old contest
 * no longer get them (that contest's own routes serve them).
 */

/**
 * SQL predicate: the live problem row behind a finished contest's snapshot may
 * be served to this viewer. `manageParam` is a boolean bind parameter (true for
 * contest staff).
 */
const liveProblemServableSql = (alias: string, manageParam: string): string =>
    `(${alias}.contest_id IS NULL OR ${manageParam}::boolean)`;

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

    // A5-04/A7-03: the viewer's contest submissions in every status (the
    // migrated `submissions` rows once the contest has finished).
    const baseQuery = `
      WITH RankedSubmissions AS (
        SELECT
          cs.id, cs.user_id, cs.problem_id, cs.score, cs.overall_status,
          cs.results, cs.submitted_at,
          ROW_NUMBER() OVER(PARTITION BY cs.user_id, cs.problem_id ORDER BY cs.score DESC, cs.id DESC) as rn_best,
          ROW_NUMBER() OVER(PARTITION BY cs.user_id, cs.problem_id ORDER BY cs.id DESC) as rn_latest
        FROM ${contestSubmissionsSql('$2', CONTEST_SUBMISSION_COLUMNS)} cs
        WHERE cs.user_id = $1 AND cs.contest_id = $2
      ),
      UserProblemStats AS (
        SELECT
          problem_id,
          MAX(score) AS best_score,
          COUNT(*) AS submission_count
        FROM RankedSubmissions
        GROUP BY problem_id
      )
    `;

    if (contest.status === CONTEST_STATUS.FINISHED) {
        const result = await db.query<ContestProblemStatsRow>(
            baseQuery + `
            SELECT
              cp.problem_id as id, cp.title, cp.author,
              COALESCE(live.problem_type, 'standard') AS problem_type,
              ups.best_score, ups.submission_count,
              latest.submitted_at AS latest_submission_at,
              latest.overall_status AS latest_submission_status,
              best.overall_status AS best_submission_status,
              best.results AS best_submission_results
            FROM contest_problems cp
            LEFT JOIN problems live ON live.id = cp.problem_id
            LEFT JOIN UserProblemStats ups ON cp.problem_id = ups.problem_id
            LEFT JOIN RankedSubmissions latest ON cp.problem_id = latest.problem_id AND latest.rn_latest = 1
            LEFT JOIN RankedSubmissions best ON cp.problem_id = best.problem_id AND best.rn_best = 1
            WHERE cp.contest_id = $2
            ORDER BY ${contestProblemOrderSql('cp', 'position')}
        `,
            [userId, contestId],
        );
        return { kind: 'ok', data: result.rows };
    }

    const result = await db.query<ContestProblemStatsRow>(
        baseQuery + `
        SELECT
          p.id, p.title, p.author, p.time_limit_ms, p.memory_limit_mb, p.problem_type,
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
        ORDER BY ${contestProblemOrderSql('p', 'contest_position')}
      `,
        [userId, contestId],
    );
    return { kind: 'ok', data: result.rows };
};

const CONTEST_SUBMISSION_COLUMNS = 'id, contest_id, user_id, problem_id, score, overall_status, results, submitted_at';

/**
 * A7-03: the viewer's best result and attempt count on one contest problem,
 * from their own contest submissions (the migrated rows once finished) —
 * the contest equivalent of getProblemViewerContext.
 */
const getContestProblemViewerStats = async (
    contestId: string,
    problemId: string,
    userId: number,
): Promise<ProblemViewerStats> => {
    const result = await db.query<ProblemViewerStatsRow>(
        `WITH mine AS (
           SELECT cs.id, cs.score, cs.results
           FROM ${contestSubmissionsSql('$1', CONTEST_SUBMISSION_COLUMNS)} cs
           WHERE cs.user_id = $3 AND cs.problem_id = $2
         )
         SELECT best.score AS best_score, best.results AS best_results,
                (SELECT COUNT(*)::int FROM mine) AS submission_count
         FROM (SELECT 1) one
         LEFT JOIN LATERAL (SELECT score, results FROM mine ORDER BY score DESC, id DESC LIMIT 1) best ON true`,
        [contestId, problemId, userId],
    );
    return toProblemViewerStats(result.rows[0]);
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

    // Staff watch a contest without joining it (§7.7); they may read its problems, never submit.
    if (!isContestManagementRole(viewer) && !(await isContestParticipant(contestId, userId))) {
        return { kind: 'not_participant' };
    }

    if (contestStatus === CONTEST_STATUS.FINISHED) {
        // A5-01: contest_problems has no PDF column; has_pdf (like the
        // starter flag) is read from the live row and gated like the routes
        // that serve those files.
        const servable = liveProblemServableSql('p', '$3');
        const result = await db.query<Omit<ContestProblemDetailRow, keyof ProblemViewerStats>>(
            `SELECT cp.problem_id AS id, cp.title, cp.author, cp.time_limit_ms, cp.memory_limit_mb,
                    (p.problem_pdf IS NOT NULL AND ${servable}) AS has_pdf,
                    COALESCE(p.problem_type, 'standard') AS problem_type, p.submission_filename,
                    (COALESCE(p.problem_type, 'standard') = 'header' AND ${servable}
                      AND EXISTS (SELECT 1 FROM problem_files f WHERE f.problem_id = cp.problem_id AND f.role = 'starter')) AS has_starter_files
             FROM contest_problems cp
             LEFT JOIN problems p ON p.id = cp.problem_id
             WHERE cp.contest_id = $1 AND cp.problem_id = $2`,
            [contestId, problemId, isContestManagementRole(viewer)],
        );
        if (!result.rows[0]) {
            return { kind: 'not_found_problem' };
        }
        return { kind: 'ok', data: { ...result.rows[0], ...(await getContestProblemViewerStats(contestId, problemId, userId)) } };
    }

    const result = await db.query<Omit<ContestProblemDetailRow, keyof ProblemViewerStats>>(
        'SELECT id, title, author, time_limit_ms, memory_limit_mb, (problem_pdf IS NOT NULL) AS has_pdf, problem_type, submission_filename, (problems.problem_type = \'header\' AND EXISTS (SELECT 1 FROM problem_files f WHERE f.problem_id = problems.id AND f.role = \'starter\')) AS has_starter_files FROM problems WHERE id = $1 AND contest_id = $2',
        [problemId, contestId],
    );
    if (!result.rows[0]) {
        return { kind: 'not_found_problem' };
    }
    return { kind: 'ok', data: { ...result.rows[0], ...(await getContestProblemViewerStats(contestId, problemId, userId)) } };
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

    // Staff watch a contest without joining it (§7.7); they may read its problems, never submit.
    if (!isContestManagementRole(viewer) && !(await isContestParticipant(contestId, userId))) {
        return { kind: 'not_participant' };
    }

    // A5-01: a finished contest serves the live problem's PDF (the snapshot
    // keeps no PDF), unless the problem now belongs to another contest.
    const finished = contestStatus === CONTEST_STATUS.FINISHED;
    const result = await db.query<{ problem_pdf: Buffer | null }>(
        finished
            ? `SELECT p.problem_pdf FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
               WHERE cp.contest_id = $1 AND cp.problem_id = $2 AND ${liveProblemServableSql('p', '$3')}`
            : 'SELECT problem_pdf FROM problems WHERE id = $1 AND contest_id = $2',
        finished ? [contestId, problemId, isContestManagementRole(viewer)] : [problemId, contestId],
    );
    const pdf = result.rows[0]?.problem_pdf ?? null;
    if (!pdf) {
        return { kind: 'not_found_pdf' };
    }
    return { kind: 'ok', data: pdf };
};

export const getContestProblemStarterForParticipant = async (
    contestId: string,
    problemId: string,
    userId: number,
    viewer?: { id: number; role: string },
): Promise<ContestProblemStarterResult> => {
    const contest = await getContestById(contestId);
    if (!contest || (!contest.is_visible && !isContestManagementRole(viewer))) {
        return { kind: 'not_found_contest' };
    }
    const contestStatus = contest.status;

    if (!ACTIVE_CONTEST_STATUSES.includes(contestStatus)) {
        return { kind: 'inactive' };
    }

    // Staff watch a contest without joining it (§7.7); they may read its problems, never submit.
    if (!isContestManagementRole(viewer) && !(await isContestParticipant(contestId, userId))) {
        return { kind: 'not_participant' };
    }

    // A5-06: a finished contest streams the LIVE starter files, so a problem
    // now attached to another contest is not served to non-staff here (the
    // standalone route 404s it too, and the new contest's route is
    // participant-only). A problem hidden after the finish stays available
    // to the old contest's participants for upsolving.
    const finished = contestStatus === CONTEST_STATUS.FINISHED;
    const result = await db.query<{ problem_type: string }>(
        finished
            ? `SELECT p.problem_type FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
               WHERE cp.contest_id = $1 AND cp.problem_id = $2 AND ${liveProblemServableSql('p', '$3')}`
            : 'SELECT problem_type FROM problems WHERE id = $1 AND contest_id = $2',
        finished ? [contestId, problemId, isContestManagementRole(viewer)] : [problemId, contestId],
    );
    if (result.rows[0]?.problem_type !== 'header') {
        return { kind: 'not_found_starter' };
    }
    const files = await getProblemFiles(problemId, 'starter');
    if (files.length === 0) {
        return { kind: 'not_found_starter' };
    }
    return { kind: 'ok', files };
};
