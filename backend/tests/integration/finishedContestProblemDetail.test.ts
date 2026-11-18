import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest, moveProblemsToContest } from '../../services/problemMigration';
import {
  getContestProblemDetailForParticipant,
  getContestProblemPdfForParticipant,
} from '../../services/contestParticipantQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A5-01: once a contest is FINISHED, its problem detail and statement PDF are
 * read from the `contest_problems` finish snapshot. Both reads must work
 * against the real schema — the final scoreboard links every problem letter
 * to /contests/:id/problems/:pid, so a query error here is a 500 for every
 * participant (and staff) opening a finished contest's problem.
 *
 * The snapshot keeps no PDF, so both come from the live problem row, which is
 * gated like the starter route (A5-06): once the problem sits in another
 * contest, non-staff viewers of the old one no longer get its files.
 */
(databaseUrl ? describe : describe.skip)('finished contest problem detail and PDF (A5-01)', () => {
  const schema = `fcpd_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const pdf = Buffer.from('%PDF-1.4 finished-contest statement');
  const staff = { id: 9, role: 'staff' };

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'u1', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'finishing', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position, problem_pdf, problem_type, submission_filename)
      VALUES ('a', 'Alpha', 'x', '{}', 1000, 256, false, 1, 1, $1, 'header', 'student.h')`, [pdf]);
    await pool.query(`INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('a', 'starter', 'student.h', $1)`,
      [Buffer.from('// starter', 'utf-8')]);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1)');
    // Finish the contest the way the scheduler does (snapshot + move back + finished).
    await migrateSubmissionsAfterContest(1);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('serves the problem detail of a finished contest to a participant', async () => {
    const status = (await pool.query('SELECT status FROM contests WHERE id = 1')).rows[0].status;
    expect(status).toBe('finished');

    const result = await getContestProblemDetailForParticipant('1', 'a', 1);
    expect(result).toMatchObject({ kind: 'ok', data: { id: 'a', title: 'Alpha', has_pdf: true } });
  });

  it('serves the problem detail of a finished contest to staff', async () => {
    const result = await getContestProblemDetailForParticipant('1', 'a', staff.id, staff);
    expect(result).toMatchObject({ kind: 'ok', data: { id: 'a', has_pdf: true } });
  });

  it('serves the statement PDF of a finished contest', async () => {
    const result = await getContestProblemPdfForParticipant('1', 'a', 1);
    expect(result.kind).toBe('ok');
    expect(Buffer.compare((result as { kind: 'ok'; data: Buffer }).data, pdf)).toBe(0);
  });

  it('keeps serving the files after the problem is hidden again (upsolving)', async () => {
    await pool.query("UPDATE problems SET is_visible = false WHERE id = 'a'");
    const detail = await getContestProblemDetailForParticipant('1', 'a', 1);
    expect(detail).toMatchObject({ kind: 'ok', data: { has_pdf: true, has_starter_files: true } });
    expect((await getContestProblemPdfForParticipant('1', 'a', 1)).kind).toBe('ok');
  });

  it('stops serving the live files to participants once the problem is in another contest; staff keep them', async () => {
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (2, 'Next', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'scheduled', false)`);
    await moveProblemsToContest(2, ['a']);

    const detail = await getContestProblemDetailForParticipant('1', 'a', 1);
    expect(detail).toMatchObject({ kind: 'ok', data: { id: 'a', title: 'Alpha', has_pdf: false, has_starter_files: false } });
    expect((await getContestProblemPdfForParticipant('1', 'a', 1)).kind).toBe('not_found_pdf');

    const staffDetail = await getContestProblemDetailForParticipant('1', 'a', staff.id, staff);
    expect(staffDetail).toMatchObject({ kind: 'ok', data: { has_pdf: true, has_starter_files: true } });
    expect((await getContestProblemPdfForParticipant('1', 'a', staff.id, staff)).kind).toBe('ok');
  });
});
