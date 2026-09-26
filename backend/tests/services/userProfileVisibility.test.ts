import * as db from '../../db';
import { getUserProfileStats } from '../../services/userProfileQueryService';
import { getRecentRewards } from '../../services/progressionService';

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

// Progression aggregation is a separate concern; only getUserProgression is
// mocked. getRecentRewards stays REAL so the listing tests below assert on
// the SQL it actually issues — it runs against the mocked db module, which
// defaults to returning no reward rows for the stats tests.
jest.mock('../../services/progressionService', () => ({
  getUserProgression: jest.fn().mockResolvedValue({
    totalXp: 0,
    level: 1,
    tier: 'Novice',
    levelProgress: { current: 0, required: 100, remaining: 100, percentage: 0 },
    globalRank: null,
  }),
  getRecentRewards: jest.requireActual('../../services/progressionService').getRecentRewards,
}));

const query = db.query as jest.Mock;

const statsRow = {
  id: 3,
  username: 'tester',
  role: 'user',
  has_avatar: false,
  avatar_updated_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  problems_attempted: 4,
  problems_solved: 2,
  total_score: 250,
  submission_count: 9,
  verdict_counts: {},
  language_counts: {},
  daily_activity: [],
  ac_days: [] as string[],
  languages_solved_in: {} as Record<string, number>,
  contests_joined: 0,
  today: '2026-09-21',
  category_stats_raw: { Math: 2 },
  category_totals_raw: { Math: 5 },
};

/**
 * PROFILE-PROBLEM-SCOPE: every profile statistic counts only currently
 * visible problems (`problems.is_visible = true`). The filter is a pure
 * query predicate — hide a problem and the numbers drop, show it and they
 * return; no history rows are ever mutated. The scope applies to every
 * viewer (admin included) so profile semantics never depend on who is
 * looking. XP/Level/Tier are the exception: they are a historical reward
 * ledger and never filtered.
 */
describe('getUserProfileStats visibility semantics (PROFILE-PROBLEM-SCOPE)', () => {
  beforeEach(() => {
    query.mockReset();
    // First call = the stats query (full row). Later calls (the REAL
    // getRecentRewards) get an empty reward list so the mapping never runs.
    query.mockResolvedValueOnce({ rows: [{ ...statsRow }] });
    query.mockResolvedValue({ rows: [] });
  });

  it('scopes the submission CTE of BOTH pools to visible problems', async () => {
    await getUserProfileStats('tester');
    const sql = query.mock.calls[0][0];

    // The visible-problems join must sit in the user_submissions CTE — the
    // single source every aggregate (solved/attempted/score/verdicts/
    // languages/activity/streak days/achievements) flows through. With an
    // INNER join on is_visible, submissions to hidden problems drop out of
    // every stat at once, and come back when the problem is shown again.
    const cteStart = sql.indexOf('WITH user_submissions AS');
    const cteEnd = sql.indexOf('best_scores AS');
    expect(cteStart).toBeGreaterThan(-1);
    expect(cteEnd).toBeGreaterThan(cteStart);
    const cte = sql.slice(cteStart, cteEnd);
    // Both arms (standalone pool and contest pool) carry the filter.
    const standaloneMatches = cte.match(/JOIN problems p ON p\.id = s\.problem_id AND p\.is_visible = true/g);
    const contestMatches = cte.match(/JOIN problems p ON p\.id = cs\.problem_id AND p\.is_visible = true/g);
    expect(standaloneMatches).toHaveLength(1);
    expect(contestMatches).toHaveLength(1);
  });

  it('filters the category radar numerator AND denominator by is_visible', async () => {
    await getUserProfileStats('tester');
    const sql = query.mock.calls[0][0];

    // Numerator (solved per category) and denominator (total per category)
    // share ONE universe: visible standalone problems. Numerator and
    // denominator must agree, so solved <= total always holds.
    const numeratorIdx = sql.indexOf('AS category_stats_raw');
    const denominatorIdx = sql.indexOf('AS category_totals_raw');
    expect(numeratorIdx).toBeGreaterThan(0);
    expect(denominatorIdx).toBeGreaterThan(numeratorIdx);
    const numerator = sql.slice(0, numeratorIdx);
    const denominator = sql.slice(0, denominatorIdx);
    expect(numerator).toContain('p.is_visible = true AND p.contest_id IS NULL');
    expect(denominator).toContain('p.is_visible = true AND p.contest_id IS NULL');
  });

  it('is viewer-independent — no role parameter is forwarded to the listing', async () => {
    // The stats query is call 0; the REAL getRecentRewards issues call 1,
    // whose parameters are exactly [userId, limit] — no viewer flag exists.
    await getUserProfileStats('tester');
    expect(query.mock.calls[1][1]).toEqual([3, 10]);
    // The stats query itself has only the username + activity window bound.
    expect(query.mock.calls[0][1]).toEqual(['tester', expect.any(Number)]);
  });
});

describe('getRecentRewards listing visibility (PROFILE-PROBLEM-SCOPE)', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('excludes hidden problems for every viewer (admin included)', async () => {
    query.mockResolvedValue({ rows: [] });

    await getRecentRewards(7, 10);

    const [sql, params] = query.mock.calls[0];
    // Visible-problems predicate for the listing, plus the deleted-problem
    // escape hatch (LEFT JOIN row is NULL -> keep, title renders null).
    expect(sql).toContain('p.id IS NULL OR p.is_visible = true');
    expect(sql).not.toContain('$3::boolean');
    expect(params).toEqual([7, 10]);
  });

  it('defaults to the same visible-only listing', async () => {
    query.mockResolvedValue({ rows: [] });

    await getRecentRewards(7);

    expect(query.mock.calls[0][1]).toEqual([7, 10]);
  });
});
