import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getHomeSummary } from '../../services/homeQueryService';
import { calculateProblemXP } from '../../services/progressionService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('GET /me/home summary', () => {
  const schema = `home_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE submissions, contest_submissions, user_problem_rewards, problems, collections, contests, users CASCADE');
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'user')");
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const problem = (id: string, opts: { difficulty?: number | null; visible?: boolean; collection?: number | null } = {}) =>
    pool.query(
      `INSERT INTO problems (id, title, author, categories, difficulty, time_limit_ms, memory_limit_mb, is_visible, collection_id)
       VALUES ($1, $2, 'A', '{}', $3, 1000, 256, $4, $5)`,
      [id, `Title ${id}`, opts.difficulty ?? null, opts.visible ?? true, opts.collection ?? null],
    );
  /** `at` is a SQL timestamptz expression. */
  const submit = (problemId: string, score: number, at = 'NOW()', results = '[]') =>
    pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES (1, $1, 'x', 'cpp', $2, $3, $4::jsonb, ${at})`,
      [problemId, score === 100 ? 'Accepted' : 'Wrong Answer', score, results],
    );
  /** Bangkok wall-clock time `daysAgo` days back at hh:mm, as a timestamptz expression. */
  const bangkok = (daysAgo: number, hhmm: string) =>
    `((date_trunc('day', NOW() AT TIME ZONE 'Asia/Bangkok') - interval '${daysAgo} days' + interval '${hhmm.replace(':', ' hours ')} minutes') AT TIME ZONE 'Asia/Bangkok')`;

  it('week counts distinct problems accepted per Bangkok day, oldest first', async () => {
    await problem('p1');
    await problem('p2');
    await submit('p1', 100, bangkok(2, '23:30'));
    await submit('p1', 100, bangkok(2, '23:40'));
    await submit('p2', 100, bangkok(1, '00:10'));
    const { week } = await getHomeSummary(1);
    expect(week).toHaveLength(7);
    expect(week.map(d => d.solved)).toEqual([0, 0, 0, 0, 1, 1, 0]);
    const today = (await pool.query("SELECT to_char(NOW() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS d")).rows[0].d;
    expect(week[6].day).toBe(today);
    expect(week[0].day < week[6].day).toBe(true);
  });

  it('continue picks the latest-tried unsolved problem', async () => {
    await problem('a', { difficulty: 800 });
    await problem('b', { difficulty: 900 });
    await problem('c', { difficulty: 1000 });
    await submit('a', 40, "NOW() - interval '2 hours'");
    await submit('b', 30, "NOW() - interval '1 hour'", '[{"status":"Accepted"},{"status":"Wrong Answer"}]');
    await submit('c', 100, 'NOW()');
    const summary = await getHomeSummary(1);
    expect(summary.continue).toMatchObject({ id: 'b', title: 'Title b', bestScore: 30, attempts: 1, caseStatuses: ['Accepted', 'Wrong Answer'] });
    expect(summary.startWith).toEqual([]);
  });

  it('startWith lists the 3 easiest unsolved when nothing is in progress', async () => {
    for (const [id, d] of [['x', 900], ['y', 1200], ['z', null], ['w', 1000], ['solved', 800]] as const) await problem(id, { difficulty: d });
    await submit('solved', 100);
    const summary = await getHomeSummary(1);
    expect(summary.continue).toBeNull();
    expect(summary.startWith.map(p => p.id)).toEqual(['x', 'w', 'y']);
    expect(summary.startWith[0]).toMatchObject({ difficulty: 900, xp: calculateProblemXP(900) });
  });

  it('collections report solved/total over visible standalone problems with the next unsolved', async () => {
    await pool.query("INSERT INTO collections (id, name) VALUES (1, 'Basics'), (2, 'Empty')");
    await problem('c1', { collection: 1, difficulty: 800 });
    await problem('c2', { collection: 1, difficulty: 900 });
    await problem('c3', { collection: 1, visible: false });
    await problem('e1', { collection: 2, visible: false });
    await submit('c1', 100);
    const { collections } = await getHomeSummary(1);
    expect(collections).toEqual([
      { id: 1, name: 'Basics', solved: 1, total: 2, next: { id: 'c2', title: 'Title c2', difficulty: 900, xp: calculateProblemXP(900) } },
    ]);
  });

  it('levelUp names the easiest unsolved problem whose XP covers the remainder', async () => {
    await problem('easy', { difficulty: 800 });
    await problem('hard', { difficulty: 2400 });
    await problem('harder', { difficulty: 3200 });
    const summary = await getHomeSummary(1);
    expect(summary.progression.levelProgress.remaining).toBe(100);
    expect(calculateProblemXP(2400)).toBeGreaterThanOrEqual(100);
    expect(summary.levelUp).toEqual({ remaining: 100, problem: { id: 'hard', title: 'Title hard', difficulty: 2400, xp: calculateProblemXP(2400) } });
    expect(summary.solvedToday).toBe(false);
    expect(summary.currentStreak).toBe(0);
  });
});
