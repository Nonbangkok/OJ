import * as db from '../db';
import { ContestRow, ContestScoreboardDetailRow } from '../types/models';
import { CONTEST_STATUS } from '../constants';
import { ContestScoreboardResponse, ContestScoreboardRow } from '../types/service';
import { isContestManagementRole } from './contestAccess';

/**
 * Scoreboard computation, split out of contestQueryService.
 *
 * Renders one of three scoreboard variants by contest status:
 * - finished: the frozen post-migration `contest_scoreboards` snapshot
 * - running/finishing: live aggregation over `contest_submissions`
 * - anything else (e.g. scheduled): participants with zero scores
 */

export const getContestScoreboard = async (
    id: string,
    viewer?: { id: number; role: string },
): Promise<ContestScoreboardResponse | null> => {
    const contestResult = await db.query<ContestRow>('SELECT * FROM contests WHERE id = $1', [id]);
    if (contestResult.rows.length === 0) {
        return null;
    }
    const contest = contestResult.rows[0];

    // Hidden contests have no scoreboard for normal users/guests — even in
    // PUBLIC mode, where scoreboards are otherwise guest-readable. The gate
    // ANDs with site policy; it never replaces it. Staff/admin see through.
    if (!contest.is_visible && !isContestManagementRole(viewer)) {
        return null;
    }

    if (contest.status === CONTEST_STATUS.FINISHED) {
        const [scoreboardResult, problemsResult] = await Promise.all([
            db.query<ContestScoreboardDetailRow>(
                `SELECT cs.*, u.username, (u.avatar_png IS NOT NULL) AS has_avatar
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
                    (u.avatar_png IS NOT NULL) AS has_avatar,
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
              (u.avatar_png IS NOT NULL) AS has_avatar,
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
