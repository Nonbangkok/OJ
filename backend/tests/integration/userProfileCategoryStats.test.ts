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

  it('computes completion percentage from solved and the visible problem totals', async () => {
    const username = await seedUser();
    const userId = await userIdOf(username);
    // 6 visible DP problems (2x2 categories for two of them), user solves 4.
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
    // A hidden problem and a contest problem exist but are outside the
    // standalone visible universe; solving the hidden one must not change
    // the visible totals math.
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time) VALUES (1, 'c', NOW(), NOW() + INTERVAL '1 day')`);
    await pool.query(`INSERT INTO problems (id, title, is_visible, categories) VALUES ('hidden', 'h', false, ARRAY['Math'])`);
    await pool.query(`INSERT INTO problems (id, title, is_visible, contest_id, categories) VALUES (99, 'c', true, 1, ARRAY['Math'])`);
    await seedSubmission(userId, 'hidden', 'Accepted');

    const stats = await categoryStatsOf(username);
    const dp = statOf(stats, 'Dynamic Programming');
    expect(dp).toMatchObject({ solved: 4, total: 6, percentage: 66.7 });
    // Math total counts only visible standalone problems (m1, m2): the
    // hidden solve contributes to nothing visible.
    expect(statOf(stats, 'Math')).toMatchObject({ solved: 0, total: 2, percentage: 0 });
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
});
