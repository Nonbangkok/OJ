import { query } from '../db';
import { RANKING_PAGE_SIZE } from '../constants';
import { getLevelFromXP, getTierForLevel } from './progressionService';
import { rankingCte, type RankingWindow } from './rankingSql';
import type { GlobalRanking, RankingRow } from '../types/service';

export { getUserGlobalRank, type RankingWindow } from './rankingSql';

interface RankingSqlRow {
  rank: number;
  username: string;
  has_avatar: boolean;
  xp: number;
  solved: number;
  total_xp: number;
}

const ROW_SELECT = `
  SELECT r.rank, u.username, (u.avatar_png IS NOT NULL) AS has_avatar, r.xp, r.solved,
         COALESCE(a.total_xp, 0)::int AS total_xp
  FROM ranked r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN (SELECT user_id, SUM(xp_awarded) AS total_xp FROM user_problem_rewards GROUP BY user_id) a
    ON a.user_id = r.user_id`;

const toRow = (row: RankingSqlRow): RankingRow => {
  const level = getLevelFromXP(Number(row.total_xp));
  return {
    rank: Number(row.rank),
    username: row.username,
    hasAvatar: Boolean(row.has_avatar),
    xp: Number(row.xp),
    solved: Number(row.solved),
    level,
    tier: getTierForLevel(level),
  };
};

/**
 * B3: one page of the global ranking by XP in the window (competition
 * ranking, ties ordered by username), the ranked-user total, and the
 * viewer's own row regardless of page. Level and tier come from all-time XP.
 */
export const getGlobalRanking = async (
  opts: { window: RankingWindow; page: number; viewerId: number | null },
): Promise<GlobalRanking> => {
  const { window, page, viewerId } = opts;
  const offset = (page - 1) * RANKING_PAGE_SIZE;
  const [rows, count, viewer] = await Promise.all([
    query<RankingSqlRow>(
      `WITH ${rankingCte(window)} ${ROW_SELECT} ORDER BY r.rank ASC, u.username ASC LIMIT ${RANKING_PAGE_SIZE} OFFSET $1`,
      [offset],
    ),
    query<{ total: number }>(`WITH ${rankingCte(window)} SELECT COUNT(*)::int AS total FROM ranked`),
    viewerId === null
      ? Promise.resolve({ rows: [] as RankingSqlRow[] })
      : query<RankingSqlRow>(`WITH ${rankingCte(window)} ${ROW_SELECT} WHERE r.user_id = $1`, [viewerId]),
  ]);
  return {
    rows: rows.rows.map(toRow),
    total: Number(count.rows[0]?.total ?? 0),
    page,
    pageSize: RANKING_PAGE_SIZE,
    window,
    viewer: viewer.rows[0] ? toRow(viewer.rows[0]) : null,
  };
};
