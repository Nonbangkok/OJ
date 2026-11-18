import { randomUUID } from 'node:crypto';
import { promises as realFs } from 'fs';
import os from 'os';
import path from 'path';
import { ZipArchive } from 'archiver';
import pg, { PoolClient } from 'pg';
import express from 'express';
import request from 'supertest';
import * as db from '../../db';
import problemRoutes from '../../controllers/problemController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processBatchUpload } from '../../services/batchUploadService';

jest.unmock('pg');
jest.mock('../../middleware/auth', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireStaffOrAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const poolRef: { current: pg.Pool | null } = { current: null };
jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
  withTransaction: async (body: (client: PoolClient) => Promise<unknown>) => {
    const pool = poolRef.current;
    if (!pool) throw new Error('integration pool not ready');
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
  },
}));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * Header-problem folders in the problem ZIP import/export:
 *  - when config.json does not say problem_type "header" (absent, or a
 *    misspelled key such as "problemType" that the non-strict schema strips),
 *    grader/ or starter/ fail the new problem instead of being dropped and
 *    the problem imported as a standard one;
 *  - a header problem that has no grader yet (allowed by admin create)
 *    survives the export/import round trip.
 */
(databaseUrl ? describe : describe.skip)('problem ZIP grader/ and starter/ folders', () => {
  const schema = `ziproles_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const exportApp = express();
  exportApp.use(express.json());
  exportApp.use(problemRoutes);
  exportApp.use(errorHandler);
  let workDir: string;

  beforeAll(async () => {
    poolRef.current = pool;
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE problems, testcases, collections CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    workDir = await realFs.mkdtemp(path.join(os.tmpdir(), 'oj-zip-roles-'));
  });
  afterEach(async () => { await realFs.rm(workDir, { recursive: true, force: true }); });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const writeZip = async (zipPath: string, entries: Record<string, string | Buffer>): Promise<string> => {
    const fsSync = jest.requireActual('fs') as typeof import('fs');
    await new Promise<void>((resolve, reject) => {
      const output = fsSync.createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 9 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
      void archive.finalize().catch(reject);
    });
    return zipPath;
  };
  const makeZip = (entries: Record<string, string | Buffer>) =>
    writeZip(path.join(workDir, `batch-${randomUUID()}.zip`), entries);
  const baseConfig = { title: 'Typo', author: 'A', time_limit_ms: 1000, memory_limit_mb: 256 };

  it('grader/ and starter/ next to a misspelled problem_type fail the problem instead of being dropped', async () => {
    const zip = await makeZip({
      'typo/config.json': JSON.stringify({ ...baseConfig, id: 'typo', problemType: 'header' }),
      'typo/grader/main.cpp': '#include "student.h"\nint main(){}\n',
      'typo/starter/student.h': '// starter\n',
      'typo/testcases/input/input01.txt': '1\n',
      'typo/testcases/output/output01.txt': '1\n',
    });

    const results = await processBatchUpload(zip);

    expect(results.added).toEqual([]);
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].directory).toBe('typo');
    expect(results.errors[0].message).toBe(
      'Problem "typo": grader/ and starter/ found, but config.json does not set "problem_type": "header".');
    expect((await pool.query("SELECT id FROM problems WHERE id = 'typo'")).rows).toEqual([]);
  });

  it('a starter/ folder alone next to a config without problem_type also fails, leaving no collection behind', async () => {
    const zip = await makeZip({
      'plain/config.json': JSON.stringify({ ...baseConfig, id: 'plain', collection: 'Fresh Collection' }),
      'plain/starter/student.h': '// starter\n',
      'plain/testcases/input/input01.txt': '1\n',
      'plain/testcases/output/output01.txt': '1\n',
    });

    const results = await processBatchUpload(zip);

    expect(results.added).toEqual([]);
    expect(results.errors).toEqual([{ directory: 'plain',
      message: 'Problem "plain": starter/ found, but config.json does not set "problem_type": "header".' }]);
    expect((await pool.query("SELECT id FROM problems WHERE id = 'plain'")).rows).toEqual([]);
    expect((await pool.query("SELECT id FROM collections WHERE name = 'Fresh Collection'")).rows).toEqual([]);
  });

  it('a header problem with an empty grader set imports, but a non-empty one still needs a .cpp', async () => {
    const zip = await makeZip({
      'nogr/config.json': JSON.stringify({ ...baseConfig, id: 'nogr', problem_type: 'header' }),
      'nogr/starter/student.h': '// starter\n',
      'hdronly/config.json': JSON.stringify({ ...baseConfig, id: 'hdronly', problem_type: 'header' }),
      'hdronly/grader/only.h': '// no cpp\n',
    });

    const results = await processBatchUpload(zip);

    expect(results.added).toEqual(['nogr']);
    expect(results.errors).toEqual([{ directory: 'hdronly',
      message: 'Problem "hdronly": Grader files must include at least one .cpp file.' }]);
    expect((await pool.query("SELECT role, filename FROM problem_files WHERE problem_id = 'nogr'")).rows)
      .toEqual([{ role: 'starter', filename: 'student.h' }]);
  });

  it('a header problem without a grader yet survives the export/import round trip', async () => {
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename)
      VALUES ('wip', 'Work In Progress', 'A', '{}', 1000, 256, false, 'header', 'student.h')`);
    await pool.query(`INSERT INTO problem_files (problem_id, role, filename, content) VALUES ('wip', 'starter', 'student.h', $1)`,
      [Buffer.from('// starter\n')]);
    await pool.query(`INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('wip', 1, '1\n', '1\n')`);

    const response = await request(exportApp)
      .post('/admin/problems/export')
      .send({ problemIds: ['wip'] })
      .buffer(true)
      .parse((incoming, callback) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        incoming.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);

    await pool.query('TRUNCATE problems, testcases, collections CASCADE');
    const exportPath = path.join(workDir, 'export-wip.zip');
    await realFs.writeFile(exportPath, response.body as Buffer);
    const results = await processBatchUpload(exportPath);

    expect(results.errors).toEqual([]);
    expect(results.added).toEqual(['wip']);
    const row = (await pool.query("SELECT problem_type, submission_filename FROM problems WHERE id = 'wip'")).rows[0];
    expect(row).toEqual({ problem_type: 'header', submission_filename: 'student.h' });
    const files = (await pool.query("SELECT role, filename FROM problem_files WHERE problem_id = 'wip'")).rows;
    expect(files).toEqual([{ role: 'starter', filename: 'student.h' }]);
  });
});
