import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { moveSingleProblemToMainSystem } from '../../services/contestQueryService';
import { getContestScoreboard } from '../../services/contestScoreboardQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

type Row = { username: string; rank: number; total_score: number; detailed_scores: Record<string, { score: number }> };

/**
 * A5-03: staff may withdraw a problem from a RUNNING contest
 * (DELETE /admin/contests/:id/problems/:pid). Its column leaves the
 * scoreboard, so its points must leave every total and rank with it — on the
 * live board and in the frozen final standings. Otherwise totals exceed the
 * sum of the visible columns and a withdrawn (e.g. broken) problem still
 * decides the ranking.
 */
(databaseUrl ? describe : describe.skip)('problem withdrawn from a running contest (A5-03)', () => {
  const schema = `rmcp_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const staff = { id: 9, role: 'staff' };
  const T0 = new Date(Date.now() - 2 * 3600_000);
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

  const submit = (user: number, problem: string, score: number, minutes: number) =>
    pool.query(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES (1, $1, $2, 'x', 'cpp', $3, $4, '[]'::jsonb, $5)`,
      [user, problem, score === 100 ? 'Accepted' : 'Wrong Answer', score, at(minutes)],
    );
  const board = async () => (await getContestScoreboard('1', staff))!;
  const summary = (rows: Row[]) => rows.map((r) => [r.username, r.rank, r.total_score]);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'u1', 'x', 'user'), (2, 'u2', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible) VALUES (1, 'C', $1, $2, 'running', true)`,
      [T0, at(240)]);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('a', 'A', 'x', '{}', 1000, 256, false, 1, 1), ('b', 'B', 'x', '{}', 1000, 256, false, 1, 2)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES (1, 1, $1), (1, 2, $1)', [T0]);

    await submit(2, 'a', 100, 5);   // u2 solves A first
    await submit(1, 'a', 100, 10);  // u1 solves A later...
    await submit(1, 'b', 100, 20);  // ...and B, which staff then withdraw

    const removed = await moveSingleProblemToMainSystem('1', 'b');
    expect(removed.kind).toBe('ok');
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('the live board no longer counts the withdrawn problem', async () => {
    const live = await board();
    expect(live.problems.map((p) => p.problem_id)).toEqual(['a']);
    const rows = live.scoreboard as unknown as Row[];
    expect(summary(rows)).toEqual([['u2', 1, 100], ['u1', 2, 100]]);
    expect(Object.keys(rows.find((r) => r.username === 'u1')!.detailed_scores)).toEqual(['a']);
  });

  it('the final standings no longer count the withdrawn problem', async () => {
    await pool.query("UPDATE contests SET status = 'finishing' WHERE id = 1");
    await migrateSubmissionsAfterContest(1);

    const final = await board();
    expect(final.status).toBe('finished');
    expect(final.problems.map((p) => p.problem_id)).toEqual(['a']);
    expect(summary(final.scoreboard as unknown as Row[])).toEqual([['u2', 1, 100], ['u1', 2, 100]]);
  });
});
