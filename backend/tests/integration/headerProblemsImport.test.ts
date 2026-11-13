import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg, { PoolClient } from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processBatchUpload } from '../../services/batchUploadService';
import { processSubmission } from '../../services/submissionService';
import { SUBMISSION_STATUS } from '../../constants';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn() }));

/**
 * Feeds the ZIP produced by content/header-problems (`./run.sh build --all`)
 * to the REAL importer, checks what lands in the database, then judges each
 * problem's reference solution with the REAL judge pipeline. Pins the
 * content pipeline's ZIP layout to the backend's actual contract.
 *
 *   HEADER_PROBLEMS_DIST  directory holding header-problems.zip and dist/<id>/
 *                         (default: ../content/header-problems/dist)
 *   HEADER_PROBLEMS_SRC   directory holding problems/<id>/solution.h
 *                         (default: ../content/header-problems/problems)
 *   HEADER_PROBLEMS_REQUIRED=1  fail instead of skipping when the ZIP is absent
 *
 * Skips when the ZIP is absent. The judge half also needs the backend image
 * (linux, root, compiled scripts/time_wrapper); without them only the import
 * assertions run.
 */
const distDir = path.resolve(process.env.HEADER_PROBLEMS_DIST ?? '../content/header-problems/dist');
const srcDir = path.resolve(process.env.HEADER_PROBLEMS_SRC ?? '../content/header-problems/problems');
const zipPath = path.join(distDir, 'header-problems.zip');
const zipPresent = fs.existsSync(zipPath);
const canJudge = process.platform === 'linux' && process.getuid?.() === 0 && fs.existsSync('scripts/time_wrapper');

if (process.env.HEADER_PROBLEMS_REQUIRED === '1' && !(process.env.INTEGRATION_DATABASE_URL && zipPresent)) {
  throw new Error(`header problems import is required but INTEGRATION_DATABASE_URL or ${zipPath} is missing`);
}

const problemIds: string[] = zipPresent
  ? fs.readdirSync(distDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(distDir, d.name, 'config.json')))
      .map(d => d.name)
      .sort()
  : [];

const readDirFiles = (dir: string): Array<[string, Buffer]> =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).sort().map(name => [name, fs.readFileSync(path.join(dir, name))] as [string, Buffer])
    : [];

(process.env.INTEGRATION_DATABASE_URL && zipPresent ? describe : describe.skip)('header problems ZIP import (end to end)', () => {
  jest.setTimeout(120_000);
  const schema = `hpimport_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL, options: `-c search_path=${schema}` });
  let userId: number;
  let workDir: string;
  let results: Awaited<ReturnType<typeof processBatchUpload>>;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    (db.withTransaction as jest.Mock).mockImplementation(async (body: (client: PoolClient) => Promise<unknown>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await body(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
    userId = (await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ('hp-tester', 'x', 'user') RETURNING id`,
    )).rows[0].id;
    // processBatchUpload deletes the archive it is given; import a private copy
    // so the build output (and a read-only mount) is never touched.
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-hp-import-'));
    const batchZip = path.join(workDir, 'batch.zip');
    fs.copyFileSync(zipPath, batchZip);
    results = await processBatchUpload(batchZip);
  });

  afterAll(async () => {
    fs.rmSync(workDir, { recursive: true, force: true });
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it('reports every problem in dist/ as added, with no errors or skips', () => {
    expect(results.errors).toEqual([]);
    expect(results.skipped).toEqual([]);
    expect([...results.added].sort()).toEqual(problemIds);
  });

  describe.each(problemIds)('%s', id => {
    const dir = path.join(distDir, id);
    const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));

    it('stores the problem row from config.json', async () => {
      const { rows } = await pool.query(
        `SELECT p.*, c.name AS collection_name, (p.problem_pdf IS NOT NULL) AS has_pdf
           FROM problems p LEFT JOIN collections c ON c.id = p.collection_id WHERE p.id = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: config.title,
        author: config.author,
        time_limit_ms: config.time_limit_ms,
        memory_limit_mb: config.memory_limit_mb,
        categories: config.categories,
        difficulty: config.difficulty,
        collection_name: config.collection,
        problem_type: 'header',
        submission_filename: config.submission_filename,
        has_pdf: true,
      });
      const pdf = fs.readFileSync(path.join(dir, `${id}.pdf`));
      expect(Buffer.compare(rows[0].problem_pdf, pdf)).toBe(0);
    });

    it('stores every testcase byte-for-byte', async () => {
      const inputs = readDirFiles(path.join(dir, 'testcases', 'input'));
      const outputs = readDirFiles(path.join(dir, 'testcases', 'output'));
      expect(inputs).toHaveLength(10);
      expect(outputs).toHaveLength(10);
      const { rows } = await pool.query(
        'SELECT case_number, input_data, output_data FROM testcases WHERE problem_id = $1 ORDER BY case_number',
        [id],
      );
      expect(rows.map(r => r.case_number)).toEqual(inputs.map((_, i) => i + 1));
      rows.forEach((row, i) => {
        expect(Buffer.from(row.input_data, 'utf8').equals(inputs[i][1])).toBe(true);
        expect(Buffer.from(row.output_data, 'utf8').equals(outputs[i][1])).toBe(true);
      });
    });

    it.each(['grader', 'starter'] as const)('stores the %s files byte-for-byte', async role => {
      const expected = readDirFiles(path.join(dir, role));
      expect(expected.length).toBeGreaterThan(0);
      const { rows } = await pool.query(
        'SELECT filename, content FROM problem_files WHERE problem_id = $1 AND role = $2 ORDER BY filename',
        [id, role],
      );
      expect(rows.map(r => r.filename)).toEqual(expected.map(([name]) => name));
      rows.forEach((row, i) => expect(Buffer.compare(row.content, expected[i][1])).toBe(0));
    });

    const solutionPath = path.join(srcDir, id, 'solution.h');
    (canJudge && fs.existsSync(solutionPath) ? it : it.skip)(
      'judges the reference solution Accepted with score 100',
      async () => {
        const inserted = await pool.query(
          `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score)
           VALUES ($1, $2, $3, 'cpp', $4, 0) RETURNING id`,
          [userId, id, fs.readFileSync(solutionPath, 'utf8'), SUBMISSION_STATUS.PENDING],
        );
        const submissionId = inserted.rows[0].id as number;
        await processSubmission(submissionId);
        const row = (await pool.query('SELECT overall_status, score, results FROM submissions WHERE id = $1', [submissionId])).rows[0];
        expect({ status: row.overall_status, score: row.score, detail: row.overall_status === SUBMISSION_STATUS.ACCEPTED ? undefined : row.results })
          .toEqual({ status: SUBMISSION_STATUS.ACCEPTED, score: 100, detail: undefined });
        expect(row.results).toHaveLength(10);
      },
    );
  });
});
