import * as db from '../db';
import { ContestDetailRow, ContestRow, ProblemRow } from '../types/models';
import { CONTEST_STATUS } from '../constants';
import { getContestById, isContestParticipant } from './contestAccess';
import {
    ContestListRow,
    ContestProblemsSummaryRow,
    ContestWritePayload,
    MoveSingleProblemToMainResult,
} from '../types/service';

// Scoreboard and participant-facing reads were split into their own modules;
// re-exported here so existing importers keep working.
export {
    getContestScoreboard,
} from './contestScoreboardQueryService';
export {
    getContestProblemsForParticipant,
    getContestProblemDetailForParticipant,
    getContestProblemPdfForParticipant,
} from './contestParticipantQueryService';

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
        isParticipant = await isContestParticipant(id, userId);
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

export const moveSingleProblemToMainSystem = async (
    contestId: string,
    problemId: string,
): Promise<MoveSingleProblemToMainResult> => {
    const contest = await getContestById(contestId);
    if (!contest) {
        return { kind: 'not_found_contest' };
    }

    if (contest.status !== CONTEST_STATUS.SCHEDULED && contest.status !== CONTEST_STATUS.RUNNING) {
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

export const joinContest = async (contestId: string, userId: number): Promise<'joined' | 'already_joined' | 'not_found' | 'ended'> => {
    const contest = await getContestById(contestId);
    if (!contest) {
        return 'not_found';
    }

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
    const contest = await getContestById(contestId);
    if (!contest) {
        return 'not_found';
    }

    if (contest.status === CONTEST_STATUS.RUNNING) {
        return 'running';
    }

    // Detaching problems and deleting the contest must be atomic: a crash in
    // between would leave problems pointing at a contest that no longer exists.
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE problems SET contest_id = NULL WHERE contest_id = $1', [contestId]);
        await client.query('DELETE FROM contests WHERE id = $1', [contestId]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    return 'deleted';
};
