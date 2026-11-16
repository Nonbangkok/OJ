import { query } from '../db';

/** Global ranking window: all-time XP, or XP awarded in the last 7 days. */
export type RankingWindow = 'all' | 'week';

/**
 * CTEs `totals` and `ranked` over `user_problem_rewards` for one window.
 * Competition ranking (RANK: 1, 2, 2, 4) is computed over every user with
 * XP in the window BEFORE any filter, LIMIT or OFFSET, so a tie split across
 * pages — or a single viewer's lookup — keeps the shared rank. Shared by the
 * global ranking page and the profile's global rank so both always agree.
 */
export const rankingCte = (window: RankingWindow): string => `
  totals AS (
    SELECT user_id, SUM(xp_awarded)::int AS xp, COUNT(*)::int AS solved
    FROM user_problem_rewards
    ${window === 'week' ? "WHERE awarded_at >= NOW() - INTERVAL '7 days'" : ''}
    GROUP BY user_id
    HAVING SUM(xp_awarded) > 0
  ),
  ranked AS (
    SELECT user_id, xp, solved, CAST(RANK() OVER (ORDER BY xp DESC) AS INT) AS rank
    FROM totals
  )`;

/** The user's all-time competition rank, or null when they hold no XP. */
export const getUserGlobalRank = async (userId: number): Promise<number | null> => {
  const result = await query<{ rank: number }>(
    `WITH ${rankingCte('all')} SELECT rank FROM ranked WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0]?.rank ?? null;
};
