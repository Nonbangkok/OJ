import * as db from '../db';
import { ContestRow, ContestScoreboardDetailRow } from '../types/models';
import { CONTEST_STATUS } from '../constants';
import { ContestScoreboardResponse, ContestScoreboardRow } from '../types/service';
import { isContestManagementRole, isContestParticipant } from './contestAccess';
import { contestProblemOrderSql } from './contestProblemOrder';
import { contestStandingsCte, standingsRankSql } from './contestStandingsSql';

/**
 * Scoreboard computation, split out of contestQueryService.
 *
 * Renders one of three scoreboard variants by contest status:
 * - finished: the frozen post-migration `contest_scoreboards` snapshot
 * - running/finishing: live aggregation over `contest_submissions`
 * - anything else (e.g. scheduled): participants with zero scores
 */

/**
 * Problem titles of a contest that has not finished are participant/staff
 * intel (§7.7): before the start only staff see them, while it runs only
 * participants and staff. Everyone else gets the ids with empty titles.
 */
const gateTitles = async (
    problems: Array<{ problem_id: string; title: string }>,
    status: string,
    contestId: string,
    viewer?: { id: number; role: string },
): Promise<Array<{ problem_id: string; title: string }>> => {
    if (isContestManagementRole(viewer)) return problems;
    const canSee = status !== CONTEST_STATUS.SCHEDULED && viewer ? await isContestParticipant(contestId, viewer.id) : false;
    return canSee ? problems : problems.map((p) => ({ ...p, title: '' }));
};

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
                `SELECT cs.*, u.username, (u.avatar_png IS NOT NULL) AS has_avatar,
                        ${standingsRankSql('cs')} AS rank
                 FROM contest_scoreboards cs
                 JOIN users u ON cs.user_id = u.id
                 WHERE cs.contest_id = $1
                 ORDER BY rank, u.username`,
                [id],
            ),
            db.query<{ problem_id: string; title: string }>(
                `SELECT problem_id, title
                 FROM contest_problems
                 WHERE contest_id = $1
                 ORDER BY ${contestProblemOrderSql('contest_problems', 'position')}`,
                [id],
            ),
        ]);

        return {
            scoreboard: scoreboardResult.rows,
            problems: problemsResult.rows,
            status: contest.status,
            start_time: contest.start_time,
        };
    }

    if (contest.status === CONTEST_STATUS.RUNNING || contest.status === CONTEST_STATUS.FINISHING) {
        const [scoreboardResult, problemsResult] = await Promise.all([
            db.query<ContestScoreboardRow>(
                `
                ${contestStandingsCte('$1')}
                SELECT s.user_id, u.username, (u.avatar_png IS NOT NULL) AS has_avatar,
                       s.total_score, s.detailed_scores, s.last_score_improvement_time,
                       ${standingsRankSql('s')} AS rank
                FROM standings s
                JOIN users u ON u.id = s.user_id
                ORDER BY rank, u.username
                `,
                [id],
            ),
            db.query<{ problem_id: string; title: string }>(
                `SELECT id AS problem_id, title
                 FROM problems
                 WHERE contest_id = $1
                 ORDER BY ${contestProblemOrderSql('problems', 'contest_position')}`,
                [id],
            ),
        ]);

        return {
            scoreboard: scoreboardResult.rows,
            problems: await gateTitles(problemsResult.rows, contest.status, id, viewer),
            status: contest.status,
            start_time: contest.start_time,
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
             ORDER BY ${contestProblemOrderSql('problems', 'contest_position')}`,
            [id],
        ),
    ]);

    return {
        scoreboard: participantsResult.rows,
        problems: await gateTitles(problemsResult.rows, contest.status, id, viewer),
        status: contest.status,
        start_time: contest.start_time,
    };
};
