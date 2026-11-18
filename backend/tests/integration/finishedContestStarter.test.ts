import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { moveProblemsToContest, migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { getContestProblemStarterForParticipant } from '../../services/contestParticipantQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A5-06 (= A8-05): the FINISHED-contest starter route confirms the
 * problem through the contest_problems snapshot, then streams the problem's
 * LIVE starter files. Once the problem has been reused in another contest
 * (hidden as a standalone problem again, `contest_id` set to the new
 * contest), a participant of the old contest must not receive the new
 * contest's current starter — the standalone /problems/:id/starter route
 * 404s it, and the new contest's own route is participant-only.
 */
(databaseUrl ? describe : describe.skip)('finished-contest starter download', () => {
  const schema = `fcst_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const oldParticipant = { id: 2, role: 'user' };

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES (2, 'old-participant', 'x', 'user')`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename)
      VALUES ('hx', 'Header X', 'A', '{}', 1000, 256, true, 'header', 'student.h')`);
    await pool.query(`INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('hx', 'starter', 'student.h', $1)`,
      [Buffer.from('// contest A starter', 'utf-8')]);

    // Contest A runs with hx, finishes, and hx migrates back to the pool.
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'Contest A', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'running', true)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 2)');
    await moveProblemsToContest(1, ['hx']);
    await pool.query("UPDATE contests SET status = 'finishing' WHERE id = 1");
    await migrateSubmissionsAfterContest(1);
    await pool.query("UPDATE contests SET status = 'finished' WHERE id = 1");
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const starterTexts = (result: Awaited<ReturnType<typeof getContestProblemStarterForParticipant>>) =>
    result.kind === 'ok' ? result.files.map((f) => Buffer.from(f.content).toString('utf-8')) : [];

  it('still serves the starter while the problem is a visible standalone problem (upsolving)', async () => {
    const result = await getContestProblemStarterForParticipant('1', 'hx', 2, oldParticipant);
    expect(result.kind).toBe('ok');
  });

  it.each([
    { label: 'a scheduled hidden contest', status: 'scheduled', isVisible: false, start: `NOW() + INTERVAL '1 day'`, end: `NOW() + INTERVAL '2 days'` },
    { label: 'a running contest', status: 'running', isVisible: true, start: `NOW() - INTERVAL '1 hour'`, end: `NOW() + INTERVAL '1 hour'` },
  ])('does not hand an old participant the current starter once the problem is in $label', async (state) => {
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (2, 'Contest B', ${state.start}, ${state.end}, $1, $2)`, [state.status, state.isVisible]);
    await moveProblemsToContest(2, ['hx']);
    await pool.query(`UPDATE problem_files SET content = $1 WHERE problem_id = 'hx' AND role = 'starter'`,
      [Buffer.from('// contest B starter', 'utf-8')]);

    const result = await getContestProblemStarterForParticipant('1', 'hx', 2, oldParticipant);
    expect(starterTexts(result).join('\n')).not.toContain('contest B starter');
    expect(result.kind).toBe('not_found_starter');
  });

  it('still serves staff once the problem is in another contest', async () => {
    await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (2, 'Contest B', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'scheduled', false)`);
    await moveProblemsToContest(2, ['hx']);

    const result = await getContestProblemStarterForParticipant('1', 'hx', 9, { id: 9, role: 'staff' });
    expect(starterTexts(result)).toEqual(['// contest A starter']);
  });
});
