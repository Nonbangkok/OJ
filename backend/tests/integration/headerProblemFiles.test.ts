import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getProblemDetail, updateProblem } from '../../services/problemQueryService';
import { hasGraderSource } from '../../services/problemFilesService';
import { getContestProblemDetailForParticipant } from '../../services/contestParticipantQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * Real-database behaviour of the header-problem file surface:
 * - `has_starter_files` is a header-only flag (the starter download route
 *   404s standard problems, so advertising it there sends students to a dead
 *   link). Files are deliberately kept when a problem is switched back to
 *   standard, which is exactly the case the flag must not report.
 * - `hasGraderSource` gates submissions and must agree with the upload-time
 *   validation, which lower-cases the extension.
 * - a submission-filename rename must not be able to shadow a stored grader
 *   file (the judge writes the submission last and would overwrite it).
 */
(databaseUrl ? describe : describe.skip)('header problem files integration', () => {
  const schema = `hpf_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE problems, contests, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const seedHeaderProblem = async (id: string, contestId: number | null = null) => {
    await pool.query(
      `INSERT INTO problems (id, title, is_visible, contest_id, problem_type, submission_filename)
       VALUES ($1, $1, true, $2, 'header', 'student.h')`,
      [id, contestId],
    );
  };

  const addFile = (id: string, role: 'grader' | 'starter', filename: string, content = '// x') =>
    pool.query(
      `INSERT INTO problem_files (problem_id, role, filename, content) VALUES ($1, $2, $3, $4)`,
      [id, role, filename, Buffer.from(content, 'utf-8')],
    );

  describe('has_starter_files', () => {
    it('is true for a header problem with starter files', async () => {
      await seedHeaderProblem('h1');
      await addFile('h1', 'starter', 'student.h');
      expect((await getProblemDetail('h1'))?.has_starter_files).toBe(true);
    });

    it('is false for a standard problem that still has starter files', async () => {
      await seedHeaderProblem('h2');
      await addFile('h2', 'starter', 'student.h');
      // Switching back to standard deliberately KEEPS the files (so the switch
      // is reversible), but the public starter route 404s standard problems.
      await updateProblem('h2', { id: 'h2', problem_type: 'standard' });

      const detail = await getProblemDetail('h2');
      expect(detail?.problem_type).toBe('standard');
      expect(detail?.has_starter_files).toBe(false);
    });

    // The running-contest detail reads `problems` directly. (The finished
    // contest reads the `contest_problems` snapshot instead; that query is
    // covered by tests/services/contestParticipantStarterFlag.test.ts, because
    // it selects cp.problem_pdf, a column no migration creates — a
    // pre-existing defect, unrelated to this flag.)
    it('is false for a standard contest problem that still has starter files', async () => {
      const user = await pool.query(
        `INSERT INTO users (username, password_hash, role) VALUES ('hpf-user', 'x', 'user') RETURNING id`,
      );
      const userId = user.rows[0].id as number;
      const contest = await pool.query(
        `INSERT INTO contests (title, start_time, end_time, status, is_visible)
         VALUES ('C', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'running', true) RETURNING id`,
      );
      const contestId = contest.rows[0].id as number;
      await pool.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [contestId, userId]);

      await seedHeaderProblem('hc1', contestId);
      await addFile('hc1', 'starter', 'student.h');
      await seedHeaderProblem('hc2', contestId);
      await addFile('hc2', 'starter', 'student.h');
      await pool.query(`UPDATE problems SET problem_type = 'standard', submission_filename = NULL WHERE id = 'hc2'`);

      const header = await getContestProblemDetailForParticipant(String(contestId), 'hc1', userId);
      const standard = await getContestProblemDetailForParticipant(String(contestId), 'hc2', userId);
      expect(header).toMatchObject({ kind: 'ok', data: { has_starter_files: true } });
      expect(standard).toMatchObject({ kind: 'ok', data: { has_starter_files: false } });
    });
  });

  describe('hasGraderSource', () => {
    it('accepts an upper-case .CPP grader extension', async () => {
      await seedHeaderProblem('h3');
      // validateProblemFileSet lower-cases the extension, so `main.CPP`
      // uploads fine and headerPreparePlan compiles it; a case-sensitive
      // check here would leave the problem permanently unsubmittable.
      await addFile('h3', 'grader', 'main.CPP', 'int main(){}');
      expect(await hasGraderSource('h3')).toBe(true);
    });

    it('stays false when no grader source is stored', async () => {
      await seedHeaderProblem('h4');
      await addFile('h4', 'grader', 'queue.h');
      expect(await hasGraderSource('h4')).toBe(false);
    });
  });

  describe('submission-filename rename invariant', () => {
    it('rejects a rename onto a stored grader filename and leaves the row unchanged', async () => {
      await seedHeaderProblem('h5');
      await addFile('h5', 'grader', 'main.cpp', 'int main(){}');
      await addFile('h5', 'grader', 'queue.h');

      const result = await updateProblem('h5', { id: 'h5', submission_filename: 'queue.h' });

      expect(result).toMatchObject({ kind: 'filename_conflict' });
      const { rows } = await pool.query(`SELECT submission_filename FROM problems WHERE id = 'h5'`);
      expect(rows[0].submission_filename).toBe('student.h');
    });

    it('allows a rename that no grader file shadows', async () => {
      await seedHeaderProblem('h6');
      await addFile('h6', 'grader', 'main.cpp', 'int main(){}');

      const result = await updateProblem('h6', { id: 'h6', submission_filename: 'queue.h' });

      expect(result).toMatchObject({ submission_filename: 'queue.h' });
    });
  });
});
