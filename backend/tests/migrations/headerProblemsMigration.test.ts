import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrations } from '../../migrations';
import { headerProblemsSql } from '../../migrations/0024HeaderProblems';
import { runMigrations } from '../../migrations/migrationRunner';

jest.unmock('pg');

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

describe('header problems migration (registration)', () => {
  it('is registered with the exported SQL', () => {
    const migration = migrations.find(({ version }) => version === '0024_header_problems');
    expect(migration).toBeDefined();
    expect(migration!.sql).toBe(headerProblemsSql);
  });
});

(databaseUrl ? describe : describe.skip)('header problems migration (real database)', () => {
  const schema = `hp_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const before = migrations.filter(({ version }) => version < '0024');

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrations(pool, before);
    await pool.query(`INSERT INTO problems (id, title) VALUES ('legacy', 'Legacy')`);
    await pool.query(headerProblemsSql);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it('adds problem_type defaulting to standard for existing rows', async () => {
    const { rows } = await pool.query(`SELECT problem_type, submission_filename FROM problems WHERE id = 'legacy'`);
    expect(rows[0].problem_type).toBe('standard');
    expect(rows[0].submission_filename).toBeNull();
  });

  it('rejects header without submission_filename', async () => {
    await expect(
      pool.query(`INSERT INTO problems (id, title, problem_type) VALUES ('h1', 'H', 'header')`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects standard with a submission_filename and unknown types', async () => {
    await expect(
      pool.query(`INSERT INTO problems (id, title, submission_filename) VALUES ('s1', 'S', 'student.h')`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(`INSERT INTO problems (id, title, problem_type) VALUES ('x1', 'X', 'weird')`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('problem_files follows problem id rename and delete', async () => {
    await pool.query(
      `INSERT INTO problems (id, title, problem_type, submission_filename) VALUES ('p1', 'P', 'header', 'student.h')`,
    );
    await pool.query(
      `INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('p1', 'grader', 'main.cpp', $1)`,
      [Buffer.from('int main(){}')],
    );
    await pool.query(`UPDATE problems SET id = 'p2' WHERE id = 'p1'`);
    const renamed = await pool.query(`SELECT problem_id FROM problem_files`);
    expect(renamed.rows).toEqual([{ problem_id: 'p2' }]);
    await pool.query(`DELETE FROM problems`);
    const left = await pool.query(`SELECT 1 FROM problem_files`);
    expect(left.rowCount).toBe(0);
  });

  it('is idempotent', async () => {
    await expect(pool.query(headerProblemsSql)).resolves.toBeDefined();
  });
});
