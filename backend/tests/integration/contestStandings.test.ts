import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { getContestScoreboard } from '../../services/contestScoreboardQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

type Detail = { score: number; attempts?: number; best_at?: string; statuses?: string[] };
type Row = { username: string; rank: number; total_score: number; detailed_scores: Record<string, Detail>; last_score_improvement_time: Date };

(databaseUrl ? describe : describe.skip)('contest standings (B9)', () => {
  const schema = `cst_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const staff = { id: 9, role: 'staff' };
  const T0 = new Date('2026-11-16T06:00:00Z');
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
  const statusesJson = (s: string[]) => JSON.stringify(s.map((status) => ({ status })));

  const submit = (user: number, problem: string, score: number, minutes: number, statuses: string[] = []) =>
    pool.query(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES (1, $1, $2, 'x', 'cpp', $3, $4, $5::jsonb, $6)`,
      [user, problem, score === 100 ? 'Accepted' : 'Wrong Answer', score, statusesJson(statuses), at(minutes)],
    );
  const board = async () => (await getContestScoreboard('1', staff))!;
  const rows = async () => (await board()).scoreboard as unknown as Row[];
  const summary = (list: Row[]) => list.map((r) => [r.username, r.rank, r.total_score]);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users CASCADE');
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'u1', 'x', 'user'), (2, 'u2', 'x', 'user'), (3, 'u3', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible) VALUES (1, 'C', $1, $2, 'running', true)`,
      [T0, at(180)]);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('a', 'A', 'x', '{}', 1000, 256, false, 1, 1), ('b', 'B', 'x', '{}', 1000, 256, false, 1, 2)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES (1, 1, $1), (1, 2, $1), (1, 3, $2)', [T0, at(5)]);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('a non-improving resubmission does not move the tie-break', async () => {
    await submit(1, 'a', 100, 10);
    await submit(2, 'a', 100, 20);
    await submit(1, 'a', 100, 30);
    expect(summary(await rows()).slice(0, 2)).toEqual([['u1', 1, 100], ['u2', 2, 100]]);
  });

  it('attempts, best_at and statuses per problem', async () => {
    await submit(1, 'a', 40, 10, ['Accepted', 'Wrong Answer']);
    await submit(1, 'a', 60, 20, ['Accepted', 'Accepted', 'Wrong Answer']);
    await submit(1, 'a', 60, 30, ['Accepted', 'Accepted', 'Time Limit Exceeded']);
    const u1 = (await rows()).find((r) => r.username === 'u1')!;
    const a = u1.detailed_scores.a;
    expect(a).toMatchObject({ score: 60, attempts: 3, statuses: ['Accepted', 'Accepted', 'Wrong Answer'] });
    expect(new Date(a.best_at!).getTime()).toBe(at(20).getTime());
    expect(new Date(u1.last_score_improvement_time).getTime()).toBe(at(20).getTime());
  });

  it('equal total and equal time share a rank', async () => {
    await submit(1, 'a', 100, 10);
    await submit(2, 'b', 100, 10);
    await submit(3, 'a', 50, 10);
    expect(summary(await rows())).toEqual([['u1', 1, 100], ['u2', 1, 100], ['u3', 3, 50]]);
  });

  it('participants with no submissions get 0 and joined_at', async () => {
    await submit(1, 'a', 100, 10);
    const u3 = (await rows()).find((r) => r.username === 'u3')!;
    expect(u3).toMatchObject({ total_score: 0, detailed_scores: {} });
    expect(new Date(u3.last_score_improvement_time).getTime()).toBe(at(5).getTime());
  });

  it('the response carries the contest status and start time', async () => {
    expect(await board()).toMatchObject({ status: 'running' });
    expect(new Date((await board()).start_time).getTime()).toBe(T0.getTime());
  });

  it('the finish snapshot stores the same detailed_scores and order as the live scoreboard', async () => {
    await submit(1, 'a', 40, 10, ['Accepted', 'Wrong Answer']);
    await submit(1, 'b', 100, 25, ['Accepted', 'Accepted']);
    await submit(2, 'a', 100, 15, ['Accepted', 'Accepted']);
    await submit(2, 'b', 40, 40, ['Accepted', 'Wrong Answer']);
    await submit(2, 'b', 40, 50, ['Accepted', 'Wrong Answer']);
    const live = (await rows()).map((r) => ({ ...r, last_score_improvement_time: new Date(r.last_score_improvement_time).getTime() }));

    await pool.query("UPDATE contests SET status = 'finishing' WHERE id = 1");
    await migrateSubmissionsAfterContest(1);
    await pool.query("UPDATE contests SET status = 'finished' WHERE id = 1");
    const finished = (await rows()).map((r) => ({ ...r, last_score_improvement_time: new Date(r.last_score_improvement_time).getTime() }));

    const pick = (list: typeof live) => list.map(({ username, rank, total_score, detailed_scores, last_score_improvement_time }) => ({
      username, rank, total_score, last_score_improvement_time,
      detailed_scores: Object.fromEntries(Object.entries(detailed_scores).map(([k, v]) => [k, { ...v, best_at: v.best_at && new Date(v.best_at).getTime() }])),
    }));
    expect(pick(finished)).toEqual(pick(live));
  });

  it('finished scoreboard of an old snapshot without attempts/best_at still returns rows with rank', async () => {
    await pool.query("UPDATE contests SET status = 'finished' WHERE id = 1");
    await pool.query(`INSERT INTO contest_scoreboards (contest_id, user_id, total_score, detailed_scores, last_score_improvement_time)
      VALUES (1, 1, 100, '{"a": {"score": 100}}', $1), (1, 2, 40, '{"a": 40}', $1)`, [at(10)]);
    const list = await rows();
    expect(summary(list)).toEqual([['u1', 1, 100], ['u2', 2, 40]]);
    expect(list[0].detailed_scores.a).toEqual({ score: 100 });
  });
});
