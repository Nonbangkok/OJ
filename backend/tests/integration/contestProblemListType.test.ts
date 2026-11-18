import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { getContestProblemsForParticipant } from '../../services/contestParticipantQueryService';
import { getContestDetail } from '../../services/contestQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A7-06: the contest problem list and the contest sidebar mark header
 * problems, so a participant knows before opening problem B that it wants a
 * student.h rather than a whole program. Both lists carry problem_type: the
 * participant list (running and finished) and the running contest detail's
 * problems, which the staff watching view lists.
 */
(databaseUrl ? describe : describe.skip)('contest problem lists carry the problem type (A7-06)', () => {
  const schema = `cplt_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const typesOf = (rows: Array<{ id: string; problem_type?: string }>) => rows.map(({ id, problem_type }) => [id, problem_type]);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible,
        contest_id, contest_position, problem_type, submission_filename) VALUES
      ('a', 'Alpha', 'x', '{}', 1000, 256, false, 1, 1, 'standard', NULL),
      ('b', 'Beta', 'x', '{}', 1000, 256, false, 1, 2, 'header', 'student.h')`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1)');
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('the participant list of a running contest', async () => {
    const list = await getContestProblemsForParticipant('1', 1, { id: 1, role: 'user' });
    expect(typesOf((list as { data: Array<{ id: string; problem_type?: string }> }).data)).toEqual([['a', 'standard'], ['b', 'header']]);
  });

  it('the participant list of a finished contest', async () => {
    await pool.query("UPDATE contests SET status = 'finishing', end_time = NOW() - INTERVAL '1 minute' WHERE id = 1");
    await migrateSubmissionsAfterContest(1);

    const list = await getContestProblemsForParticipant('1', 1, { id: 1, role: 'user' });
    expect(typesOf((list as { data: Array<{ id: string; problem_type?: string }> }).data)).toEqual([['a', 'standard'], ['b', 'header']]);
  });

  it("the running contest detail's problems (the staff watching view)", async () => {
    const detail = await getContestDetail('1', { id: 9, role: 'staff' });
    expect(typesOf(detail!.problems as Array<{ id: string; problem_type?: string }>)).toEqual([['a', 'standard'], ['b', 'header']]);
  });
});
