import * as db from '../db';
import { ACTIVE_CONTEST_STATUSES, ContestDetailRow, ContestProblemRow, ContestRow, ContestScoreboardDetailRow, ProblemRow } from '../types/models';
import { CONTEST_STATUS } from '../constants';
import {
    ContestListRow,
    ContestProblemDetailRow,
    ContestProblemDetailResult,
    ContestProblemPdfResult,
    ContestProblemsSummaryRow,
    ContestProblemsForParticipantResult,
    ContestProblemStatsRow,
    ContestScoreboardResponse,
    ContestScoreboardRow,
    ContestWritePayload,
    ExistsRow,
    MoveSingleProblemToMainResult,
} from '../types/service';

export const listContests = async (userId?: number): Promise<ContestListRow[]> => {
    if (userId) {
        const result = await db.query<ContestListRow>(
            `
            SELECT
              c.id, c.title, c.description, c.start_time, c.end_time, c.status,
              c.created_at,
              COUNT(DISTINCT cp.user_id) AS participant_count,
              CASE WHEN user_participation.user_id IS NOT NULL THEN true ELSE false END AS is_participant,
              CASE
                WHEN c.status = '${CONTEST_STATUS.FINISHED}' THEN COALESCE(finished_problems.problem_count, 0)
                ELSE COALESCE(active_problems.problem_count, 0)
              END AS problem_count
            FROM contests c
            LEFT JOIN contest_participants cp ON c.id = cp.contest_id
            LEFT JOIN (
              SELECT DISTINCT contest_id, user_id
              FROM contest_participants
              WHERE user_id = $1
            ) user_participation ON c.id = user_participation.contest_id
            LEFT JOIN (
              SELECT contest_id, COUNT(*) AS problem_count
              FROM contest_problems
              GROUP BY contest_id
            ) finished_problems ON c.id = finished_problems.contest_id AND c.status = '${CONTEST_STATUS.FINISHED}'
            LEFT JOIN (
              SELECT contest_id, COUNT(*) AS problem_count
              FROM problems
              WHERE contest_id IS NOT NULL
              GROUP BY contest_id
            ) active_problems ON c.id = active_problems.contest_id AND c.status != '${CONTEST_STATUS.FINISHED}'
            GROUP BY c.id, c.title, c.description, c.start_time, c.end_time, c.status, c.created_at, user_participation.user_id, finished_problems.problem_count, active_problems.problem_count
            ORDER BY c.start_time DESC
            `,
            [userId],
        );
        return result.rows;
    }

    const result = await db.query<ContestListRow>(`
        SELECT
          c.id, c.title, c.description, c.start_time, c.end_time, c.status,
          c.created_at,
          COUNT(DISTINCT cp.user_id) AS participant_count,
          false AS is_participant,
          CASE
            WHEN c.status = '${CONTEST_STATUS.FINISHED}' THEN COALESCE(finished_problems.problem_count, 0)
            ELSE COALESCE(active_problems.problem_count, 0)
          END AS problem_count
        FROM contests c
        LEFT JOIN contest_participants cp ON c.id = cp.contest_id
        LEFT JOIN (
          SELECT contest_id, COUNT(*) AS problem_count
          FROM contest_problems
          GROUP BY contest_id
        ) finished_problems ON c.id = finished_problems.contest_id AND c.status = '${CONTEST_STATUS.FINISHED}'
        LEFT JOIN (
          SELECT contest_id, COUNT(*) AS problem_count
          FROM problems
          WHERE contest_id IS NOT NULL
          GROUP BY contest_id
        ) active_problems ON c.id = active_problems.contest_id AND c.status != '${CONTEST_STATUS.FINISHED}'
        GROUP BY c.id, c.title, c.description, c.start_time, c.end_time, c.status, c.created_at, finished_problems.problem_count, active_problems.problem_count
        ORDER BY c.start_time DESC
    `);
    return result.rows;
};

export const getContestDetail = async (id: string, userId?: number): Promise<(ContestDetailRow & { problems: ContestProblemsSummaryRow[]; is_participant: boolean }) | null> => {
    const contestResult = await db.query<ContestDetailRow>(
        `
        SELECT
          c.*,
          COUNT(cp.user_id) AS participant_count,
          u.username AS created_by_username
        FROM contests c
        LEFT JOIN contest_participants cp ON c.id = cp.contest_id
        LEFT JOIN users u ON c.created_by = u.id
        WHERE c.id = $1
        GROUP BY c.id, c.title, c.description, c.start_time, c.end_time, c.status, c.created_at, c.created_by, u.username
        `,
        [id],
    );
    if (contestResult.rows.length === 0) {
        return null;
    }

    const contest = contestResult.rows[0];

    let isParticipant = false;
    if (userId) {
        const participantResult = await db.query<ExistsRow>(
            'SELECT 1 AS exists FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
            [id, userId],
        );
        isParticipant = participantResult.rows.length > 0;
    }

    let problems: ContestProblemsSummaryRow[] = [];
    if (contest.status === CONTEST_STATUS.RUNNING || contest.status === CONTEST_STATUS.FINISHED) {
        if (contest.status === CONTEST_STATUS.FINISHED) {
            const problemsResult = await db.query<ContestProblemsSummaryRow>(
                `SELECT problem_id AS id, title, author
                 FROM contest_problems
                 WHERE contest_id = $1
                 ORDER BY problem_id`,
                [id],
            );
            problems = problemsResult.rows;
        } else {
            const problemsResult = await db.query<ContestProblemsSummaryRow>(
                `SELECT id, title, author
                 FROM problems
                 WHERE contest_id = $1
                 ORDER BY id`,
                [id],
            );
            problems = problemsResult.rows;
        }
    }

    return {
        ...contest,
        problems,
        is_participant: isParticipant,
    };
};

export const getContestScoreboard = async (id: string): Promise<ContestScoreboardResponse | null> => {
    const contestResult = await db.query<ContestRow>('SELECT * FROM contests WHERE id = $1', [id]);
    if (contestResult.rows.length === 0) {
        return null;
    }
    const contest = contestResult.rows[0];

    if (contest.status === CONTEST_STATUS.FINISHED) {
        const [scoreboardResult, problemsResult] = await Promise.all([
            db.query<ContestScoreboardDetailRow>(
                `SELECT cs.*, u.username
                 FROM contest_scoreboards cs
                 JOIN users u ON cs.user_id = u.id
                 WHERE cs.contest_id = $1
                 ORDER BY cs.total_score DESC, cs.last_score_improvement_time ASC`,
                [id],
            ),
            db.query<{ problem_id: string; title: string }>(
                `SELECT problem_id, title
                 FROM contest_problems
                 WHERE contest_id = $1
                 ORDER BY problem_id`,
                [id],
            ),
        ]);

        return {
            scoreboard: scoreboardResult.rows,
            problems: problemsResult.rows,
        };
    }

    if (contest.status === CONTEST_STATUS.RUNNING || contest.status === CONTEST_STATUS.FINISHING) {
        const [scoreboardResult, problemsResult] = await Promise.all([
            db.query<ContestScoreboardRow>(
                `
                WITH UserBestScores AS (
                  SELECT
                    cs.user_id,
                    cs.problem_id,
                    MAX(cs.score) AS best_score,
                    MAX(cs.submitted_at) AS latest_score_time
                  FROM contest_submissions cs
                  WHERE cs.contest_id = $1
                  GROUP BY cs.user_id, cs.problem_id
                ),
                UserTotalScores AS (
                  SELECT
                    ubs.user_id,
                    SUM(ubs.best_score) AS total_score,
                    jsonb_object_agg(ubs.problem_id, jsonb_build_object('score', ubs.best_score)) AS detailed_scores,
                    MAX(ubs.latest_score_time) AS last_score_improvement_time
                  FROM UserBestScores ubs
                  GROUP BY ubs.user_id
                ),
                AllParticipants AS (
                  SELECT
                    cp.user_id,
                    u.username,
                    COALESCE(uts.total_score, 0) AS total_score,
                    COALESCE(uts.detailed_scores, '{}'::jsonb) AS detailed_scores,
                    COALESCE(uts.last_score_improvement_time, cp.joined_at) AS last_score_improvement_time
                  FROM contest_participants cp
                  JOIN users u ON cp.user_id = u.id
                  LEFT JOIN UserTotalScores uts ON uts.user_id = cp.user_id
                  WHERE cp.contest_id = $1
                )
                SELECT *
                FROM AllParticipants
                ORDER BY total_score DESC, last_score_improvement_time ASC
                `,
                [id],
            ),
            db.query<{ problem_id: string; title: string }>(
                `SELECT id AS problem_id, title
                 FROM problems
                 WHERE contest_id = $1
                 ORDER BY id`,
                [id],
            ),
        ]);

        return {
            scoreboard: scoreboardResult.rows,
            problems: problemsResult.rows,
        };
    }

    const [participantsResult, problemsResult] = await Promise.all([
        db.query<ContestScoreboardRow>(
            `SELECT
              cp.user_id,
              u.username,
              0 AS total_score,
              '{}'::jsonb AS detailed_scores
             FROM contest_participants cp
             JOIN users u ON cp.user_id = u.id
             WHERE cp.contest_id = $1
             ORDER BY u.username ASC`,
            [id],
        ),
        db.query<{ problem_id: string; title: string }>(
            `SELECT id AS problem_id, title
             FROM problems
             WHERE contest_id = $1
             ORDER BY id`,
            [id],
        ),
    ]);

    return {
        scoreboard: participantsResult.rows,
        problems: problemsResult.rows,
    };
};

export const moveSingleProblemToMainSystem = async (
    contestId: string,
    problemId: string,
): Promise<MoveSingleProblemToMainResult> => {
    const contestResult = await db.query<ContestRow>('SELECT * FROM contests WHERE id = $1', [contestId]);
    if (contestResult.rows.length === 0) {
        return { kind: 'not_found_contest' };
    }

    const contest = contestResult.rows[0];
    if (contest.status !== 'scheduled' && contest.status !== CONTEST_STATUS.RUNNING) {
        return { kind: 'invalid_status' };
    }

    const updateResult = await db.query<Pick<ProblemRow, 'id' | 'title'>>(
        'UPDATE problems SET contest_id = NULL WHERE id = $1 AND contest_id = $2 RETURNING id, title',
        [problemId, contestId],
    );
    if (!updateResult.rows[0]) {
        return { kind: 'not_found_problem' };
    }

    return { kind: 'ok', data: updateResult.rows[0] };
};

export const getContestProblemsForParticipant = async (
    contestId: string,
    userId: number,
): Promise<ContestProblemsForParticipantResult> => {
    const contestResult = await db.query<ContestRow>('SELECT * FROM contests WHERE id = $1', [contestId]);
    if (contestResult.rows.length === 0) {
        return { kind: 'not_found' };
    }

    const contest = contestResult.rows[0];
    const participantResult = await db.query<ExistsRow>(
        'SELECT 1 AS exists FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [contestId, userId],
    );
    if (participantResult.rows.length === 0) {
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
): Promise<ContestProblemDetailResult> => {
    const contestResult = await db.query<Pick<ContestRow, 'status'>>('SELECT status FROM contests WHERE id = $1', [contestId]);
    if (contestResult.rows.length === 0) {
        return { kind: 'not_found_contest' };
    }

    const contestStatus = contestResult.rows[0].status;
    if (!ACTIVE_CONTEST_STATUSES.includes(contestStatus)) {
        return { kind: 'inactive' };
    }

    const participantResult = await db.query<ExistsRow>(
        'SELECT 1 AS exists FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [contestId, userId],
    );
    if (participantResult.rows.length === 0) {
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
): Promise<ContestProblemPdfResult> => {
    const contestResult = await db.query<Pick<ContestRow, 'status'>>('SELECT status FROM contests WHERE id = $1', [contestId]);
    if (contestResult.rows.length === 0) {
        return { kind: 'not_found_contest' };
    }

    const contestStatus = contestResult.rows[0].status;
    if (!ACTIVE_CONTEST_STATUSES.includes(contestStatus)) {
        return { kind: 'inactive' };
    }

    const participantResult = await db.query<ExistsRow>(
        'SELECT 1 AS exists FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [contestId, userId],
    );
    if (participantResult.rows.length === 0) {
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

export const joinContest = async (contestId: string, userId: number): Promise<'joined' | 'already_joined' | 'not_found' | 'ended'> => {
    const contestResult = await db.query<ContestRow>('SELECT * FROM contests WHERE id = $1', [contestId]);
    if (contestResult.rows.length === 0) {
        return 'not_found';
    }

    const contest = contestResult.rows[0];
    if (new Date() >= new Date(contest.end_time)) {
        return 'ended';
    }

    const insertResult = await db.query(
        'INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [contestId, userId],
    );

    if (insertResult.rowCount === 0) {
        return 'already_joined';
    }

    return 'joined';
};

export const createContest = async (payload: ContestWritePayload, createdBy: number): Promise<ContestRow> => {
    const result = await db.query<ContestRow>(
        `INSERT INTO contests (title, description, start_time, end_time, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [payload.title, payload.description, payload.startTime, payload.endTime, createdBy],
    );
    return result.rows[0];
};

export const updateContest = async (contestId: string, payload: ContestWritePayload): Promise<ContestRow | null> => {
    const result = await db.query<ContestRow>(
        `UPDATE contests
         SET title = $1, description = $2, start_time = $3, end_time = $4
         WHERE id = $5
         RETURNING *`,
        [payload.title, payload.description, payload.startTime, payload.endTime, contestId],
    );
    return result.rows[0] ?? null;
};

export const deleteContest = async (contestId: string): Promise<'deleted' | 'not_found' | 'running'> => {
    const contestResult = await db.query<ContestRow>('SELECT * FROM contests WHERE id = $1', [contestId]);
    if (contestResult.rows.length === 0) {
        return 'not_found';
    }

    const contest = contestResult.rows[0];
    if (contest.status === CONTEST_STATUS.RUNNING) {
        return 'running';
    }

    await db.query('UPDATE problems SET contest_id = NULL WHERE contest_id = $1', [contestId]);
    await db.query('DELETE FROM contests WHERE id = $1', [contestId]);
    return 'deleted';
};
