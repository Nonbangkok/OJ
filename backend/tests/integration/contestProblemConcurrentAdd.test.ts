import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { moveProblemsToContest } from '../../services/problemMigration';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A5-10: two staff add the same problem to two contests at the same moment.
 * Exactly one add may win; the other must fail with 409 instead of silently
 * re-homing the problem and overwriting its pre-contest visibility snapshot
 * with the FALSE the first add wrote.
 *
 * A third connection holds the problem row while both adds start, so both
 * get past their own checks before either can write; then it lets go.
 */
(databaseUrl ? describe : describe.skip)('concurrent add of one problem to two contests (A5-10)', () => {
  const schema = `cpa_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

  const waitForLockWaiters = async (count: number) => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { rows } = await admin.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity
         WHERE application_name = $1 AND state = 'active' AND wait_event_type = 'Lock'`,
        [schema],
      );
      if (rows[0].n >= count) return;
      if (Date.now() > deadline) throw new Error(`expected ${count} transactions waiting on the problem row`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status) VALUES
      (1, 'A', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'scheduled'),
      (2, 'B', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'scheduled')`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('x', 'X', 'a', '{}', 1000, 256, true), ('y', 'Y', 'a', '{}', 1000, 256, true)`);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('one add wins, the other answers 409, and the visibility snapshot survives', async () => {
    const blocker = await pool.connect();
    let results: PromiseSettledResult<unknown>[];
    try {
      await blocker.query('BEGIN');
      await blocker.query(`UPDATE problems SET title = title WHERE id = 'x'`);

      const adds = [moveProblemsToContest(1, ['x']), moveProblemsToContest(2, ['x'])];
      await waitForLockWaiters(2);
      await blocker.query('COMMIT');
      results = await Promise.allSettled(adds);
    } finally {
      blocker.release();
    }

    const won = results.findIndex((r) => r.status === 'fulfilled');
    const lost = results.findIndex((r) => r.status === 'rejected');
    expect(won).not.toBe(-1);
    expect(lost).not.toBe(-1);
    expect((results[lost] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

    const problem = await pool.query(`SELECT contest_id, is_visible, is_visible_before_contest FROM problems WHERE id = 'x'`);
    expect(problem.rows).toEqual([{ contest_id: won + 1, is_visible: false, is_visible_before_contest: true }]);
  });

  it('a problem already in another contest is refused with 409, and nothing of the request is moved', async () => {
    await moveProblemsToContest(1, ['x']);

    await expect(moveProblemsToContest(2, ['y', 'x'])).rejects.toMatchObject({ statusCode: 409 });

    const rows = await pool.query('SELECT id, contest_id FROM problems ORDER BY id');
    expect(rows.rows).toEqual([{ id: 'x', contest_id: 1 }, { id: 'y', contest_id: null }]);
  });
});
