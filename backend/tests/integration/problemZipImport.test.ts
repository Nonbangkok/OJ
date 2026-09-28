import { randomUUID } from 'node:crypto';
import { promises as realFs } from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import pg, { PoolClient } from 'pg';
import * as db from '../../db';
import express from 'express';
import request from 'supertest';
import unzipper from 'unzipper';
import problemRoutes from '../../controllers/problemController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { processBatchUpload } from '../../services/batchUploadService';

jest.unmock('pg');
jest.mock('../../middleware/auth', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireStaffOrAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// The service's transaction path must land on the integration pool, not on
// db.ts's real pool (which has no DATABASE_URL in tests). The pool reference
// is resolved lazily at call time — the mock factory runs before the
// suite-level pool is constructed.
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

type ProblemRow = {
  id: string;
  title: string;
  author: string;
  categories: string[] | null;
  difficulty: number | null;
  collection_id: number | null;
};

type CollectionRow = { id: number; name: string };

/**
 * End-to-end coverage of the problem-ZIP config.json metadata feature:
 * categories / difficulty / collection, on real migrations — new problems,
 * existing-problem update semantics (omitted vs null), collection reuse and
 * single-creation, and rollback of an orphaned collection.
 */
(databaseUrl ? describe : describe.skip)('problem ZIP import metadata', () => {
  const schema = `zipmeta_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
    application_name: schema,
  });
  const exportApp = express();
  exportApp.use(express.json());
  exportApp.use(problemRoutes);
  exportApp.use(errorHandler);

  beforeAll(async () => {
    poolRef.current = pool;
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE problems, testcases, collections CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) =>
      pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  let workDir: string;
  const makeZip = async (entries: Record<string, string | Buffer>): Promise<string> => {
    const fsSync = jest.requireActual('fs') as typeof import('fs');
    const zipPath = path.join(workDir, `batch-${randomUUID()}.zip`);
    await new Promise<void>((resolve, reject) => {
      const output = fsSync.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const [name, content] of Object.entries(entries)) {
        archive.append(content, { name });
      }
      void archive.finalize().catch(reject);
    });
    return zipPath;
  };

  const configJson = (config: Record<string, unknown>): string => JSON.stringify(config, null, 2);

  const fetchProblem = async (id: string): Promise<ProblemRow | null> => {
    const result = await pool.query<ProblemRow>(
      'SELECT id, title, author, categories, difficulty, collection_id FROM problems WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  };

  const fetchCollections = async (): Promise<CollectionRow[]> =>
    (await pool.query<CollectionRow>('SELECT id, name FROM collections ORDER BY name')).rows;

  const baseConfig = {
    id: 'aplusb',
    title: 'A Plus B',
    author: 'Nonbangkok',
    time_limit_ms: 1000,
    memory_limit_mb: 256,
  };

  const exportZip = async (problemIds: string[]): Promise<Buffer> => {
    const response = await request(exportApp)
      .post('/admin/problems/export')
      .send({ problemIds })
      .buffer(true)
      .parse((incoming, callback) => {
        const chunks: Buffer[] = [];
        incoming.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        incoming.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    return response.body as Buffer;
  };

  const readExportedConfigs = async (zip: Buffer): Promise<Record<string, Record<string, unknown>>> => {
    const directory = await unzipper.Open.buffer(zip);
    const configs: Record<string, Record<string, unknown>> = {};
    for (const entry of directory.files) {
      if (entry.path.endsWith('/config.json')) {
        const config = JSON.parse((await entry.buffer()).toString('utf8')) as Record<string, unknown>;
        configs[String(config.id)] = config;
      }
    }
    return configs;
  };

  beforeEach(async () => {
    workDir = await realFs.mkdtemp(path.join(os.tmpdir(), 'oj-zip-import-'));
  });

  afterEach(async () => {
    await realFs.rm(workDir, { recursive: true, force: true });
  });

  it('imports a legacy single-problem ZIP (no metadata fields) with defaults', async () => {
    const zipPath = await makeZip({
      'config.json': configJson(baseConfig),
      'testcases.zip': '', // no testcase content needed for this test
    });
    const results = await processBatchUpload(zipPath);

    expect(results.added).toEqual(['aplusb']);
    const problem = await fetchProblem('aplusb');
    expect(problem).toMatchObject({
      title: 'A Plus B',
      categories: [],
      difficulty: null,
      collection_id: null,
    });
    // No collections were created.
    expect(await fetchCollections()).toEqual([]);
  });

  it('imports a batch ZIP with categories, difficulty, and a new collection', async () => {
    const zipPath = await makeZip({
      'P1/config.json': configJson({
        ...baseConfig,
        id: 'tree-dp',
        title: 'Tree DP',
        categories: ['Tree', 'Graph', 'Tree'],
        difficulty: 2100,
        collection: 'Chapter 1',
      }),
      'P2/config.json': configJson({
        ...baseConfig,
        id: 'binary-search',
        title: 'Binary Search',
        categories: ['Binary Search'],
        difficulty: 800,
        collection: 'Chapter 1',
      }),
    });

    const results = await processBatchUpload(zipPath);
    expect(results.added).toEqual(['tree-dp', 'binary-search']);
    expect(results.errors).toEqual([]);

    const treeDp = await fetchProblem('tree-dp');
    expect(treeDp?.categories).toEqual(['Graph', 'Tree']); // deduped
    expect(treeDp?.difficulty).toBe(2100);

    const bs = await fetchProblem('binary-search');
    expect(bs?.categories).toEqual(['Binary Search']);
    expect(bs?.difficulty).toBe(800);

    // Two problems referencing the same collection name got ONE collection.
    const collections = await fetchCollections();
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('Chapter 1');
    expect(treeDp?.collection_id).toBe(collections[0].id);
    expect(bs?.collection_id).toBe(collections[0].id);
  });

  it('exports selected problems with portable metadata and round-trips the exported ZIP through import', async () => {
    const sourceZip = await makeZip({
      'SourceA/config.json': configJson({
        ...baseConfig, id: 'roundtrip-a', title: 'Round Trip A',
        categories: ['Graph', 'Tree'], difficulty: 1800, collection: 'Classical Problems',
      }),
      'SourceB/config.json': configJson({
        ...baseConfig, id: 'roundtrip-b', title: 'Round Trip B',
        categories: [], difficulty: null, collection: null,
      }),
    });
    expect((await processBatchUpload(sourceZip)).errors).toEqual([]);

    const multiExport = await exportZip(['roundtrip-a', 'roundtrip-b']);
    const configs = await readExportedConfigs(multiExport);
    expect(Object.keys(configs).sort()).toEqual(['roundtrip-a', 'roundtrip-b']);
    expect(configs['roundtrip-a']).toEqual({
      id: 'roundtrip-a', title: 'Round Trip A', author: 'Nonbangkok',
      time_limit_ms: 1000, memory_limit_mb: 256,
      categories: ['Graph', 'Tree'], difficulty: 1800, collection: 'Classical Problems',
    });
    expect(configs['roundtrip-b']).toEqual({
      id: 'roundtrip-b', title: 'Round Trip B', author: 'Nonbangkok',
      time_limit_ms: 1000, memory_limit_mb: 256,
      categories: [], difficulty: null, collection: null,
    });
    for (const config of Object.values(configs)) {
      expect(Array.isArray(config.categories)).toBe(true);
      expect(config.difficulty === null || typeof config.difficulty === 'number').toBe(true);
      expect(config.collection === null || typeof config.collection === 'string').toBe(true);
      expect(config).not.toHaveProperty('collection_id');
      expect(config).not.toHaveProperty('problem_pdf');
    }

    const singleExport = await exportZip(['roundtrip-a']);
    expect(await readExportedConfigs(singleExport)).toMatchObject({
      'roundtrip-a': { categories: ['Graph', 'Tree'], difficulty: 1800, collection: 'Classical Problems' },
    });

    await pool.query('TRUNCATE problems, collections CASCADE');
    const exportPath = path.join(workDir, 'export-roundtrip.zip');
    await realFs.writeFile(exportPath, multiExport);
    const results = await processBatchUpload(exportPath);
    expect(results.added).toEqual(['roundtrip-a', 'roundtrip-b']);
    expect(results.errors).toEqual([]);
    expect(await fetchProblem('roundtrip-a')).toMatchObject({
      categories: ['Graph', 'Tree'], difficulty: 1800,
    });
    expect(await fetchProblem('roundtrip-b')).toMatchObject({
      categories: [], difficulty: null, collection_id: null,
    });
    const collections = await fetchCollections();
    expect(collections.map(collection => collection.name)).toEqual(['Classical Problems']);
    expect((await fetchProblem('roundtrip-a'))?.collection_id).toBe(collections[0].id);
  });

  it('reuses an existing collection instead of duplicating it', async () => {
    const existing = await pool.query(
      'INSERT INTO collections (name) VALUES ($1) RETURNING id',
      ['Classical Problem'],
    );
    const existingId = existing.rows[0].id as number;

    const zipPath = await makeZip({
      'config.json': configJson({ ...baseConfig, collection: 'Classical Problem' }),
    });
    const results = await processBatchUpload(zipPath);
    expect(results.added).toEqual(['aplusb']);

    const collections = await fetchCollections();
    expect(collections).toHaveLength(1);
    expect(collections[0].id).toBe(existingId);
    const problem = await fetchProblem('aplusb');
    expect(problem?.collection_id).toBe(existingId);
  });

  it('rolls back the auto-created collection when the problem import fails', async () => {
    // config.json is invalid (unknown category) *after* a collection name is
    // present — validation happens before any write, so nothing persists.
    const zipPath = await makeZip({
      'config.json': configJson({ ...baseConfig, categories: ['Graphs'], collection: 'Doomed' }),
    });
    const results = await processBatchUpload(zipPath);

    expect(results.added).toEqual([]);
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].message).toContain('Problem "aplusb"');
    expect(results.errors[0].message).toContain('Unknown category "Graphs"');
    expect(await fetchCollections()).toEqual([]);
  });

  it('rolls back a failed problem row (and its collection) mid-transaction', async () => {
    // A valid config whose insert is doomed by an over-long id: the DB column
    // is VARCHAR(50), so the INSERT fails *after* the collection upsert ran.
    const zipPath = await makeZip({
      'config.json': configJson({
        ...baseConfig,
        id: 'x'.repeat(80),
        collection: 'Doomed Chapter',
      }),
    });
    const results = await processBatchUpload(zipPath);

    expect(results.added).toEqual([]);
    expect(results.errors).toHaveLength(1);
    // The transaction rolled the collection back — no orphan.
    expect(await fetchCollections()).toEqual([]);
  });

  it('updates an existing problem: omitted fields are preserved', async () => {
    const chapter = await pool.query(
      'INSERT INTO collections (name) VALUES ($1) RETURNING id',
      ['Existing Chapter'],
    );
    await pool.query(
      `INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb, is_visible,
         categories, difficulty, collection_id)
       VALUES ($1, $2, $3, $4, $5, true, $6::text[], $7, $8)`,
      ['aplusb', 'Old Title', 'Old Author', 500, 128, ['Math', 'Greedy'], 1200, chapter.rows[0].id],
    );

    // Re-import the same id with metadata fields omitted: title/author/limits
    // keep their old values (the problem row is skipped, not overwritten),
    // and the metadata stays as stored.
    const zipPath = await makeZip({
      'config.json': configJson({ ...baseConfig }),
    });
    const results = await processBatchUpload(zipPath);

    expect(results.skipped).toEqual(['aplusb']);
    expect(results.added).toEqual([]);
    const problem = await fetchProblem('aplusb');
    expect(problem).toMatchObject({
      title: 'Old Title',
      author: 'Old Author',
      difficulty: 1200,
      collection_id: chapter.rows[0].id,
    });
    // Categories were omitted from the ZIP — stored set untouched.
    expect([...(problem?.categories ?? [])].sort()).toEqual(['Greedy', 'Math']);
  });

  it('updates an existing problem: explicit null/[] clears, values replace', async () => {
    const chapter = await pool.query(
      'INSERT INTO collections (name) VALUES ($1) RETURNING id',
      ['Existing Chapter'],
    );
    await pool.query(
      `INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb, is_visible,
         categories, difficulty, collection_id)
       VALUES ($1, $2, $3, $4, $5, true, $6::text[], $7, $8)`,
      ['aplusb', 'Old Title', 'Old Author', 500, 128, ['Math'], 1200, chapter.rows[0].id],
    );

    const zipPath = await makeZip({
      'config.json': configJson({
        ...baseConfig,
        categories: [],
        difficulty: null,
        collection: '   ',
      }),
    });
    await processBatchUpload(zipPath);

    const problem = await fetchProblem('aplusb');
    expect(problem).toMatchObject({
      categories: [],
      difficulty: null,
      collection_id: null,
    });
    // The existing collection still exists (other problems may reference it).
    expect((await fetchCollections()).map((c) => c.name)).toEqual(['Existing Chapter']);
  });

  it('updates an existing problem: values replace, collection by name', async () => {
    const oldChapter = await pool.query(
      'INSERT INTO collections (name) VALUES ($1) RETURNING id',
      ['Old Chapter'],
    );
    await pool.query(
      `INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb, is_visible,
         categories, difficulty, collection_id)
       VALUES ($1, $2, $3, $4, $5, true, $6::text[], $7, $8)`,
      ['aplusb', 'Old Title', 'Old Author', 500, 128, ['Math'], 1200, oldChapter.rows[0].id],
    );

    const zipPath = await makeZip({
      'config.json': configJson({
        ...baseConfig,
        categories: ['Graph'],
        difficulty: 2500,
        collection: 'New Chapter',
      }),
    });
    await processBatchUpload(zipPath);

    const problem = await fetchProblem('aplusb');
    expect(problem?.categories).toEqual(['Graph']);
    expect(problem?.difficulty).toBe(2500);
    const collections = await fetchCollections();
    expect(collections.map((c) => c.name)).toEqual(['New Chapter', 'Old Chapter']);
    expect(problem?.collection_id).toBe(
      collections.find((c) => c.name === 'New Chapter')?.id ?? null,
    );
  });

  it('rejects an out-of-scale difficulty per problem without breaking the batch', async () => {
    const zipPath = await makeZip({
      'P1/config.json': configJson({ ...baseConfig, id: 'good', difficulty: 9000 }),
      'P2/config.json': configJson({ ...baseConfig, id: 'fine', difficulty: 1500 }),
    });
    const results = await processBatchUpload(zipPath);

    expect(results.added).toEqual(['fine']);
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].directory).toBe('P1');
    expect(results.errors[0].message).toContain('Problem "good"');
    expect(results.errors[0].message).toContain('difficulty');
  });

  it('treats a single-problem ZIP root and batch subdirectories identically', async () => {
    // Single-problem ZIP (config.json at root) — same parser, same semantics.
    const single = await makeZip({
      'config.json': configJson({ ...baseConfig, id: 'single', collection: 'Solo' }),
    });
    const singleResult = await processBatchUpload(single);
    expect(singleResult.added).toEqual(['single']);

    // Batch ZIP with one subdirectory.
    const batch = await makeZip({
      'sub/config.json': configJson({ ...baseConfig, id: 'batched', collection: 'Solo' }),
    });
    const batchResult = await processBatchUpload(batch);
    expect(batchResult.added).toEqual(['batched']);

    // Both landed in the one collection created from the first import.
    const collections = await fetchCollections();
    expect(collections).toHaveLength(1);
    const soloId = collections[0].id;
    expect((await fetchProblem('single'))?.collection_id).toBe(soloId);
    expect((await fetchProblem('batched'))?.collection_id).toBe(soloId);
  });
});
