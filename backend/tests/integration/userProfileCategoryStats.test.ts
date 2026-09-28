import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { getUserProfileStats } from '../../services/userProfileQueryService';
import { runMigrationsFromPool } from '../../scripts/migrate';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('user profile category stats integration', () => {
  const schema = `catstats_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE submissions, contest_submissions, contests, contest_participants, problems, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  let userSeq = 0;

  const seedUser = async (): Promise<string> => {
    const username = `catuser${++userSeq}`;
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ($1, 'x')`, [username]);
    return username;
  };

  const userIdOf = async (username: string): Promise<number> =>
    (await pool.query(`SELECT id FROM users WHERE username = $1`, [username])).rows[0].id as number;

  /** Problems carry TEXT[] categories (possibly empty = Uncategorized). */
  const seedProblem = (id: string, categories: string[]) =>
    pool.query(
      `INSERT INTO problems (id, title, is_visible, categories) VALUES ($1, $1, true, $2::text[])`,
      [id, categories],
    );

  const seedSubmission = (
    userId: number,
    problemId: string,
    status: string,
  ) =>
    pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, submitted_at)
       VALUES ($1, $2, 'int main(){}', 'cpp', $3, $4, NOW())`,
      [userId, problemId, status, status === 'Accepted' ? 100 : 0],
    );

  type CategoryStat = { category: string; solved: number; total: number; percentage: number };

  const categoryStatsOf = async (username: string): Promise<CategoryStat[]> => {
    const stats = await getUserProfileStats(username);
    expect(stats).not.toBeNull();
    return (stats as unknown as { categoryStats: CategoryStat[] }).categoryStats;
  };

  const statOf = (stats: CategoryStat[], category: string): CategoryStat | undefined =>
    stats.find((stat) => stat.category === category);

  const solvedOf = (stats: CategoryStat[], category: string): number =>
    statOf(stats, category)?.solved ?? -1;

  it('counts each solved problem once regardless of accepted submission count', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('dp1', ['Dynamic Programming']);
    for (let i = 0; i < 5; i += 1) await seedSubmission(userId, 'dp1', 'Accepted');

    const stats = await categoryStatsOf(username);
    expect(solvedOf(stats, 'Dynamic Programming')).toBe(1);
  });

  it('increments every category of a multi-category solved problem', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('both', ['Dynamic Programming', 'Graph']);
    await seedSubmission(userId, 'both', 'Accepted');

    const stats = await categoryStatsOf(username);
    expect(solvedOf(stats, 'Dynamic Programming')).toBe(1);
    expect(solvedOf(stats, 'Graph')).toBe(1);
  });

  it('counts a solved problem without categories under Uncategorized', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('plain', []);
    await seedSubmission(userId, 'plain', 'Accepted');

    const stats = await categoryStatsOf(username);
    expect(solvedOf(stats, 'Uncategorized')).toBe(1);
  });

  it('does not file a categorized problem under Uncategorized', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('tagged', ['Math']);
    await seedSubmission(userId, 'tagged', 'Accepted');

    const stats = await categoryStatsOf(username);
    expect(solvedOf(stats, 'Math')).toBe(1);
    expect(stats.find((stat) => stat.category === 'Uncategorized')?.solved ?? 0).toBe(0);
  });

  it('ignores non-accepted submissions', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('wa', ['Greedy']);
    await seedProblem('re', ['Sorting']);
    await seedSubmission(userId, 'wa', 'Wrong Answer');
    await seedSubmission(userId, 're', 'Runtime Error');

    const stats = await categoryStatsOf(username);
    expect(stats.every((stat) => stat.solved === 0)).toBe(true);
  });

  it('returns zero-value categories so every axis stays present', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('one', ['Math']);
    await seedSubmission(userId, 'one', 'Accepted');

    const stats = await categoryStatsOf(username);
    // Every system category exists (fixed radar order + the remaining
    // closed-list entries + Uncategorized), including untouched ones.
    const PROBLEM_CATEGORY_COUNT = 16;
    expect(stats).toHaveLength(PROBLEM_CATEGORY_COUNT + 1);
    expect(solvedOf(stats, 'Tree')).toBe(0);
    expect(solvedOf(stats, 'Bitmasks')).toBe(0);
    expect(solvedOf(stats, 'String')).toBe(0);
  });

  it('computes completion percentage over the visible standalone universe (PROFILE-PROBLEM-SCOPE)', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    // 6 visible DP problems, user solves 4.
    for (const [id, cats] of [
      ['dp1', ['Dynamic Programming']],
      ['dp2', ['Dynamic Programming']],
      ['dp3', ['Dynamic Programming']],
      ['dp4', ['Dynamic Programming']],
      ['dp5', ['Dynamic Programming']],
      ['dp6', ['Dynamic Programming']],
      ['m1', ['Math']],
      ['m2', ['Math']],
    ] as const) {
      await seedProblem(id, [...cats]);
    }
    // dp1 solved twice: still one solved problem.
    await seedSubmission(userId, 'dp1', 'Accepted');
    await seedSubmission(userId, 'dp1', 'Accepted');
    for (const id of ['dp2', 'dp3', 'dp4']) await seedSubmission(userId, id, 'Accepted');
    // A hidden problem and a contest problem exist. Both are outside the
    // visible standalone universe on BOTH numerator and denominator: the
    // hidden solve counts nowhere, and the hidden problem itself is not in
    // the totals.
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time) VALUES (1, 'c', NOW(), NOW() + INTERVAL '1 day')`);
    await pool.query(`INSERT INTO problems (id, title, is_visible, categories) VALUES ('hidden', 'h', false, ARRAY['Math'])`);
    await pool.query(`INSERT INTO problems (id, title, is_visible, contest_id, categories) VALUES (99, 'c', true, 1, ARRAY['Math'])`);
    await seedSubmission(userId, 'hidden', 'Accepted');

    const stats = await categoryStatsOf(username);
    const dp = statOf(stats, 'Dynamic Programming');
    expect(dp).toMatchObject({ solved: 4, total: 6, percentage: 66.7 });
    // The hidden Math solve counts NOWHERE: not in the numerator, and the
    // hidden problem is not in the denominator either (only m1, m2 count).
    expect(statOf(stats, 'Math')).toMatchObject({ solved: 0, total: 2, percentage: 0 });
  });

  it('drops every stat when a solved problem is hidden and restores it on show (PROFILE-PROBLEM-SCOPE reversibility)', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('dp1', ['Dynamic Programming']);
    await seedProblem('dp2', ['Dynamic Programming']);
    await seedSubmission(userId, 'dp1', 'Accepted');
    await seedSubmission(userId, 'dp2', 'Wrong Answer');

    // Visible baseline: both problems in scope.
    const before = await getUserProfileStats(username);
    const dpBefore = statOf(before!.categoryStats, 'Dynamic Programming');
    expect(dpBefore).toMatchObject({ solved: 1, total: 2, percentage: 50 });
    expect(Number(before!.problems_solved)).toBe(1);
    expect(Number(before!.problems_attempted)).toBe(2);
    expect(Number(before!.submission_count)).toBe(2);
    expect(Number(before!.total_score)).toBe(100);
    expect(before!.verdict_counts).toEqual({ Accepted: 1, 'Wrong Answer': 1 });

    // Admin hides the solved problem: every stat drops — solved, attempted,
    // score, submission count, verdicts, and the radar numerator; the hidden
    // problem also leaves the radar denominator.
    await pool.query(`UPDATE problems SET is_visible = false WHERE id = 'dp1'`);

    const hidden = await getUserProfileStats(username);
    const dpHidden = statOf(hidden!.categoryStats, 'Dynamic Programming');
    expect(dpHidden).toMatchObject({ solved: 0, total: 1, percentage: 0 });
    expect(Number(hidden!.problems_solved)).toBe(0);
    expect(Number(hidden!.problems_attempted)).toBe(1);
    expect(Number(hidden!.submission_count)).toBe(1);
    expect(Number(hidden!.total_score)).toBe(0);
    expect(hidden!.verdict_counts).toEqual({ 'Wrong Answer': 1 });
    expect(hidden!.recentRewards.map((reward) => reward.problemId)).toEqual([]);
    // History is untouched: the submission row is still in the DB.
    const rows = await pool.query(`SELECT COUNT(*)::int AS n FROM submissions WHERE user_id = $1 AND problem_id = 'dp1'`, [userId]);
    expect(rows.rows[0].n).toBe(1);

    // Showing the problem again restores every number — the filter is a
    // pure query predicate, nothing was mutated.
    await pool.query(`UPDATE problems SET is_visible = true WHERE id = 'dp1'`);

    const restored = await getUserProfileStats(username);
    expect(statOf(restored!.categoryStats, 'Dynamic Programming'))
      .toMatchObject({ solved: 1, total: 2, percentage: 50 });
    expect(Number(restored!.problems_solved)).toBe(1);
    expect(Number(restored!.problems_attempted)).toBe(2);
    expect(Number(restored!.submission_count)).toBe(2);
    expect(Number(restored!.total_score)).toBe(100);
    expect(restored!.verdict_counts).toEqual({ Accepted: 1, 'Wrong Answer': 1 });
  });

  it('excludes an attempted-but-unsolved hidden problem from attempted/score while unsolved hidden problems never touch the denominator (PROFILE-PROBLEM-SCOPE)', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('vis', ['Math']);
    await pool.query(`INSERT INTO problems (id, title, is_visible, categories) VALUES ('hid', 'h', false, ARRAY['Math'])`);
    // Attempt both; solve only the visible one.
    await seedSubmission(userId, 'vis', 'Accepted');
    await seedSubmission(userId, 'hid', 'Wrong Answer');

    const stats = await getUserProfileStats(username);
    // Attempted counts visible problems only: 'hid' is attempted but hidden,
    // so it must not appear in attempted, score, or solve-rate inputs.
    expect(Number(stats!.problems_attempted)).toBe(1);
    expect(Number(stats!.problems_solved)).toBe(1);
    expect(Number(stats!.total_score)).toBe(100);
    // Solve rate (solved/attempted, computed client-side from these two)
    // stays consistent: both sides use the same visible-only scope.
    expect(Math.round((Number(stats!.problems_solved) / Number(stats!.problems_attempted)) * 100)).toBe(100);
    // The hidden problem is also absent from the radar denominator: a user
    // who never touched a hidden problem sees it counted nowhere.
    expect(statOf(stats!.categoryStats, 'Math')).toMatchObject({ solved: 1, total: 1, percentage: 100 });
  });

  it('reports 100% for a fully solved category and 0/0 without NaN for empty ones', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('m1', ['Math']);
    await seedProblem('m2', ['Math']);
    await seedSubmission(userId, 'm1', 'Accepted');
    await seedSubmission(userId, 'm2', 'Accepted');

    const stats = await categoryStatsOf(username);
    expect(statOf(stats, 'Math')).toMatchObject({ solved: 2, total: 2, percentage: 100 });
    // A category with no problems at all: 0/0 -> percentage 0, never NaN.
    const constructive = statOf(stats, 'Constructive');
    expect(constructive).toMatchObject({ solved: 0, total: 0, percentage: 0 });
    expect(Number.isFinite(constructive?.percentage)).toBe(true);
  });

  it('keeps the fixed category order regardless of solved counts', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    // Solve several Tree problems so it would sort first by count.
    await seedProblem('t1', ['Tree']);
    await seedProblem('t2', ['Tree']);
    await seedProblem('t3', ['Tree']);
    await seedProblem('m1', ['Math']);
    for (const problem of ['t1', 't2', 't3', 'm1']) await seedSubmission(userId, problem, 'Accepted');

    const stats = await categoryStatsOf(username);
    const order = stats.map((stat) => stat.category);
    expect(order.indexOf('Dynamic Programming')).toBeLessThan(order.indexOf('Math'));
    expect(order.indexOf('Math')).toBeLessThan(order.indexOf('Tree'));
    expect(order.indexOf('Uncategorized')).toBe(order.length - 1);
  });

  it('scopes to the requesting user only', async () => {
    const mine = await seedUser();
    const other = await seedUser();
    const mineId = await userIdOf(mine);
    const otherId = await userIdOf(other);
    await seedProblem('shared', ['Graph']);
    await seedSubmission(mineId, 'shared', 'Accepted');
    await seedSubmission(otherId, 'shared', 'Accepted');
    await seedSubmission(otherId, 'shared', 'Accepted');

    const stats = await categoryStatsOf(mine);
    expect(solvedOf(stats, 'Graph')).toBe(1);
  });

  it('keeps the Recently Solved listing visible-only for EVERY viewer, admin included (PROFILE-PROBLEM-SCOPE)', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('vis1', ['Math']);
    await pool.query(`INSERT INTO problems (id, title, is_visible, categories) VALUES ('hid1', 'h', false, ARRAY['Math'])`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time) VALUES (1, 'c', NOW(), NOW() + INTERVAL '1 day')`);
    await pool.query(`INSERT INTO problems (id, title, is_visible, contest_id, categories) VALUES ('con1', 'c', true, 1, ARRAY['Math'])`);

    for (const problemId of ['vis1', 'hid1', 'con1', 'gone1']) {
      await pool.query(
        `INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, difficulty_snapshot, awarded_at)
         VALUES ($1, $2, 10, 800, NOW() - INTERVAL '1 hour')`,
        [userId, problemId],
      );
    }

    // Hidden problem titles/IDs must not appear — for every viewer. The
    // scope is the canonical `problems.is_visible` field: the contest-
    // assigned problem here is seeded VISIBLE (artificial edge case), so it
    // stays listed — in production the contest migration hides contest
    // problems (is_visible = false) and they drop out through the same
    // predicate. The reward for the deleted problem ('gone1', no problems
    // row) keeps its null-title slot — the reward is earned history, there
    // is no problem metadata left to leak.
    const stats = await getUserProfileStats(username);
    const ids = stats!.recentRewards.map((reward) => reward.problemId);
    expect(ids).not.toContain('hid1');
    expect([...ids].sort()).toEqual(['con1', 'gone1', 'vis1']);
    const gone = stats!.recentRewards.find((reward) => reward.problemId === 'gone1');
    expect(gone?.problemTitle).toBeNull();

    // Showing the hidden problem brings its reward back into the listing —
    // pure query predicate, nothing mutated. (con1 stays listed the whole
    // time: it is seeded visible, and contest-vs-general scope rides on
    // is_visible, which the migration manages.)
    await pool.query(`UPDATE problems SET is_visible = true WHERE id = 'hid1'`);
    const restored = await getUserProfileStats(username);
    expect(restored!.recentRewards.map((reward) => reward.problemId).sort())
      .toEqual(['con1', 'gone1', 'hid1', 'vis1']);
  });

  it('drops every category of a hidden multi-category problem from the radar numerator (PROFILE-PROBLEM-SCOPE)', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('multi', ['Dynamic Programming', 'Graph']);
    await seedProblem('dpOnly', ['Dynamic Programming']);
    await seedSubmission(userId, 'multi', 'Accepted');
    await seedSubmission(userId, 'dpOnly', 'Accepted');

    // Both categories gain the solve while the problem is visible.
    const before = await categoryStatsOf(username);
    expect(solvedOf(before, 'Dynamic Programming')).toBe(2);
    expect(solvedOf(before, 'Graph')).toBe(1);

    await pool.query(`UPDATE problems SET is_visible = false WHERE id = 'multi'`);

    const after = await categoryStatsOf(username);
    // The hidden problem leaves BOTH category numerators, and its category
    // totals drop on both axes (the denominator is visible-only too). Only
    // the still-visible dpOnly solve/total remains on the DP axis.
    expect(solvedOf(after, 'Dynamic Programming')).toBe(1);
    expect(solvedOf(after, 'Graph')).toBe(0);
    expect(statOf(after, 'Dynamic Programming')?.total).toBe(1);
    expect(statOf(after, 'Graph')?.total).toBe(0);
  });

  it('excludes hidden-problem AC days from streaks and the activity heatmap (PROFILE-PROBLEM-SCOPE)', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('today', ['Math']);
    // Starts visible; the hide happens mid-test below.
    await seedProblem('hiddenAc', ['Math']);

    // Standalone-pool AC days: yesterday on the soon-to-be-hidden problem,
    // today on a visible one.
    const day = async (offset: number) =>
      (await pool.query(
        `SELECT to_char((NOW() AT TIME ZONE 'Asia/Bangkok') + ($1 || ' days')::interval, 'YYYY-MM-DD') AS day`,
        [String(offset)],
      )).rows[0].day as string;
    const yesterday = await day(-1);
    const today = await day(0);
    const at = (localDate: string) => `${localDate}T10:00:00+07:00`;
    await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, submitted_at)
       VALUES ($1, 'hiddenAc', 'x', 'cpp', 'Accepted', 100, $2)`,
      [userId, at(yesterday)],
    );
    await pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, submitted_at)
       VALUES ($1, 'today', 'x', 'cpp', 'Accepted', 100, $2)`,
      [userId, at(today)],
    );

    // While both problems are visible: a 2-day streak and both activity days.
    const before = await getUserProfileStats(username);
    expect(before!.current_streak).toBe(2);
    expect(before!.last_ac_date).toBe(today);
    expect(before!.daily_activity.map((entry) => entry.day)).toEqual([yesterday, today]);

    // Hide the problem whose AC filled yesterday: that day no longer
    // qualifies as a streak event, so the streak resets to just today and
    // the heatmap cell for yesterday disappears. (The streak ALGORITHM is
    // untouched — only the visible-problem scope of its input days.)
    await pool.query(`UPDATE problems SET is_visible = false WHERE id = 'hiddenAc'`);
    const after = await getUserProfileStats(username);
    expect(after!.current_streak).toBe(1);
    expect(after!.longest_streak).toBe(1);
    expect(after!.last_ac_date).toBe(today);
    expect(after!.daily_activity.map((entry) => entry.day)).toEqual([today]);

    // And the submission rows behind it are untouched.
    const rows = await pool.query(`SELECT COUNT(*)::int AS n FROM submissions WHERE user_id = $1 AND problem_id = 'hiddenAc'`, [userId]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('never touches XP / level / tier when problems are hidden (XP is a historical reward ledger)', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    await seedProblem('xp1', ['Math']);
    await pool.query(
      `INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, difficulty_snapshot, awarded_at)
       VALUES ($1, 'xp1', 250, 800, NOW())`,
      [userId],
    );

    const before = await getUserProfileStats(username);
    expect(before!.progression.totalXp).toBe(250);

    // Hiding the solved problem drops Solved to 0 and empties the Recently
    // Solved listing, but the XP reward ledger is historical: total XP,
    // level, tier and rank must not move.
    await pool.query(`UPDATE problems SET is_visible = false WHERE id = 'xp1'`);
    const after = await getUserProfileStats(username);
    expect(Number(after!.problems_solved)).toBe(0);
    expect(after!.recentRewards).toEqual([]);
    expect(after!.progression.totalXp).toBe(250);
    expect(after!.progression.level).toBe(before!.progression.level);
    expect(after!.progression.tier).toBe(before!.progression.tier);
    // The reward row itself is still in the DB.
    const rows = await pool.query(`SELECT COUNT(*)::int AS n FROM user_problem_rewards WHERE user_id = $1 AND problem_id = 'xp1'`, [userId]);
    expect(rows.rows[0].n).toBe(1);
  });
});
