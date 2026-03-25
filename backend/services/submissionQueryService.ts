import * as db from '../db';
import { CONTEST_STATUS, SUBMISSION_STATUS } from '../constants';
import {
    ContestRuntimeRow,
    ContestSubmissionDetailRow,
    SubmissionDetailRow,
} from '../types/models';
import { SubmissionListQuery, SubmitRequestBody } from '../types/api';
import { AppError } from '../middleware/errorHandler';
import {
    ExistsRow,
    GlobalScoreboardRow,
    IdTitlePair,
    QueueSubmissionResult,
    SearchUserRow,
    SubmissionListRow,
} from '../types/service';

export const validateAndQueueSubmission = async (
    submission: SubmitRequestBody,
    userId: number,
): Promise<QueueSubmissionResult> => {
    const { problemId, language, code, contestId } = submission;

    if (language !== 'cpp') {
        throw new AppError('Only C++ is supported.', 400);
    }

    if (!problemId || !code) {
        throw new AppError('Problem ID and code are required.', 400);
    }

    if (contestId) {
        const contestResult = await db.query<ContestRuntimeRow>(
            'SELECT id, status, start_time, end_time FROM contests WHERE id = $1',
            [contestId],
        );
        if (contestResult.rows.length === 0) {
            throw new AppError('Contest not found.', 404);
        }

        const contest = contestResult.rows[0];
        if (contest.status !== CONTEST_STATUS.RUNNING) {
            throw new AppError(`Contest is not running. Current status: ${contest.status}`, 400);
        }

        const participantResult = await db.query<ExistsRow>(
            'SELECT 1 AS exists FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
            [contestId, userId],
        );
        if (participantResult.rows.length === 0) {
            throw new AppError('You must join the contest before submitting.', 403);
        }

        const problemResult = await db.query<ExistsRow>(
            'SELECT 1 AS exists FROM problems WHERE id = $1 AND contest_id = $2',
            [problemId, contestId],
        );
        if (problemResult.rows.length === 0) {
            throw new AppError('Problem does not belong to this contest.', 400);
        }

        const submissionResult = await db.query<{ id: number }>(
            `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score)
             VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id`,
            [contestId, userId, problemId, code, language, SUBMISSION_STATUS.PENDING],
        );

        return {
            submissionId: submissionResult.rows[0].id,
            isContestSubmission: true,
        };
    }

    const problemResult = await db.query<ExistsRow>(
        'SELECT 1 AS exists FROM problems WHERE id = $1 AND is_visible = true AND contest_id IS NULL',
        [problemId],
    );
    if (problemResult.rows.length === 0) {
        throw new AppError('Problem is not available for submission.', 400);
    }

    const submissionResult = await db.query<{ id: number }>(
        `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
         VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
        [userId, problemId, code, language, SUBMISSION_STATUS.PENDING],
    );

    return {
        submissionId: submissionResult.rows[0].id,
        isContestSubmission: false,
    };
};

export const getSubmissions = async (
    queryInput: SubmissionListQuery,
    userId: number,
    isStaffOrAdmin: boolean,
): Promise<SubmissionListRow[]> => {
    const { filter, problemId, contestId, filterProblemId, filterUserId } = queryInput;

    let queryText: string;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (contestId) {
        queryText = `
            SELECT
              cs.id, u.username, cs.problem_id, p.title AS problem_title,
              cs.overall_status, cs.score, cs.language, cs.submitted_at
            FROM contest_submissions cs
            JOIN users u ON cs.user_id = u.id
            JOIN problems p ON cs.problem_id = p.id
        `;
        params.push(contestId);
        conditions.push(`cs.contest_id = $${params.length}`);
    } else {
        queryText = `
            SELECT
              s.id, u.username, s.problem_id, p.title AS problem_title,
              s.overall_status, s.score, s.language, s.submitted_at
            FROM submissions s
            JOIN users u ON s.user_id = u.id
            JOIN problems p ON s.problem_id = p.id
        `;
    }

    const sourceAlias = contestId ? 'cs' : 's';

    if (filter === 'mine') {
        params.push(userId);
        conditions.push(`${sourceAlias}.user_id = $${params.length}`);
    }

    if (problemId) {
        params.push(problemId);
        conditions.push(`${sourceAlias}.problem_id = $${params.length}`);
    }

    if (isStaffOrAdmin) {
        if (filterProblemId) {
            params.push(`%${filterProblemId}%`);
            conditions.push(`${sourceAlias}.problem_id IN (SELECT id FROM problems WHERE id ILIKE $${params.length})`);
        }

        if (filterUserId) {
            params.push(`%${filterUserId}%`);
            conditions.push(`${sourceAlias}.user_id IN (SELECT id FROM users WHERE username ILIKE $${params.length})`);
        }
    }

    if (conditions.length > 0) {
        queryText += ` WHERE ${conditions.join(' AND ')}`;
    }

    queryText += ` ORDER BY ${sourceAlias}.submitted_at DESC LIMIT 200`;
    const result = await db.query<SubmissionListRow>(queryText, params);
    return result.rows;
};

export const searchProblems = async (queryText: string, contestId?: string): Promise<IdTitlePair[]> => {
    if (!queryText.trim()) {
        return [];
    }

    if (!contestId) {
        const result = await db.query<IdTitlePair>(
            'SELECT id, title FROM problems WHERE id ILIKE $1 OR title ILIKE $1 LIMIT 10',
            [`%${queryText}%`],
        );
        return result.rows;
    }

    const contestResult = await db.query<Pick<ContestRuntimeRow, 'status'>>(
        'SELECT status FROM contests WHERE id = $1',
        [contestId],
    );
    if (contestResult.rows.length === 0) {
        return [];
    }

    const contestStatus = contestResult.rows[0].status;
    if (contestStatus === CONTEST_STATUS.FINISHED) {
        const result = await db.query<IdTitlePair>(
            `SELECT problem_id AS id, title
             FROM contest_problems
             WHERE contest_id = $1 AND (problem_id ILIKE $2 OR title ILIKE $2)
             LIMIT 10`,
            [contestId, `%${queryText}%`],
        );
        return result.rows;
    }

    const result = await db.query<IdTitlePair>(
        `SELECT id, title
         FROM problems
         WHERE contest_id = $1 AND (id ILIKE $2 OR title ILIKE $2)
         LIMIT 10`,
        [contestId, `%${queryText}%`],
    );
    return result.rows;
};

export const searchUsers = async (queryText: string, contestId?: string): Promise<SearchUserRow[]> => {
    if (!queryText.trim()) {
        return [];
    }

    if (!contestId) {
        const result = await db.query<SearchUserRow>(
            'SELECT username FROM users WHERE username ILIKE $1 LIMIT 10',
            [`%${queryText}%`],
        );
        return result.rows;
    }

    const result = await db.query<SearchUserRow>(
        `SELECT u.username
         FROM users u
         JOIN contest_participants cp ON u.id = cp.user_id
         WHERE cp.contest_id = $1 AND u.username ILIKE $2
         LIMIT 10`,
        [contestId, `%${queryText}%`],
    );
    return result.rows;
};

export const getSubmissionDetail = async (
    id: string,
    contestId?: string,
): Promise<SubmissionDetailRow | ContestSubmissionDetailRow | null> => {
    if (contestId) {
        // For contest submissions, we join with contest_problems (the snapshot)
        const result = await db.query<ContestSubmissionDetailRow>(
            `SELECT cs.*, u.username, cp.title AS problem_name
             FROM contest_submissions cs
             LEFT JOIN users u ON cs.user_id = u.id
             LEFT JOIN contest_problems cp ON cs.problem_id = cp.problem_id AND cs.contest_id = cp.contest_id
             WHERE cs.id = $1 AND cs.contest_id = $2`,
            [id, contestId],
        );
        return result.rows[0] ?? null;
    }

    const result = await db.query<SubmissionDetailRow>(
        `SELECT s.*, u.username, p.title AS problem_name
         FROM submissions s
         LEFT JOIN users u ON s.user_id = u.id
         LEFT JOIN problems p ON s.problem_id = p.id
         WHERE s.id = $1`,
        [id],
    );
    return result.rows[0] ?? null;
};

export const getGlobalScoreboard = async (): Promise<GlobalScoreboardRow[]> => {
    const result = await db.query<GlobalScoreboardRow>(`
      WITH UserBestScores AS (
        SELECT
          user_id,
          problem_id,
          MAX(score) AS best_score,
          MAX(submitted_at) AS latest_score_time
        FROM submissions
        GROUP BY user_id, problem_id
      )
      SELECT
        u.username,
        SUM(ubs.best_score) AS total_score,
        COUNT(CASE WHEN ubs.best_score = 100 THEN 1 END) AS problems_solved,
        MAX(ubs.latest_score_time) AS last_score_improvement_time
      FROM UserBestScores ubs
      JOIN users u ON ubs.user_id = u.id
      GROUP BY u.username
      ORDER BY total_score DESC, last_score_improvement_time ASC
    `);
    return result.rows;
};
