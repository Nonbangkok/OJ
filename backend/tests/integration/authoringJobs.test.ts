import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { setTimeout as delay } from 'node:timers/promises';
import * as db from '../../db';
import { createAuthoringJobRouter } from '../../controllers/authoringJobController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { createProblemDraft, updateProblemDraft } from '../../services/authoringDraftQueryService';
import { queueCompileJob, applyJobResult, getAuthoringJob } from '../../services/authoringJobQueryService';
import { reconcileAuthoringJobs } from '../../services/authoringJobCoordinator';
import { AuthoringSpool } from '../../authoring/spool';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { query: jest.fn(), connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('durable authoring job protocol', () => {
  const schema = `slice4_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  let root: string;
  let spool: AuthoringSpool;
  beforeAll(async () => { await adminPool.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts CASCADE');
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-jobs-'));
    spool = new AuthoringSpool(root);
    await spool.initialize();
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  afterAll(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
  const draft = () => createProblemDraft({ problem_id: 'test', title: 'Fixture', author_profile_id: null,
    author_aka_name: 'A', author_real_name: 'Author', language: 'Thai', country_code: 'THA',
    time_limit_ms: 1000, memory_limit_mb: 256, created_by: null, solution_cpp: 'int main(){}' }, database);

  it('reserves one job per draft and recovers delivery after a backend restart', async () => {
    const d = await draft();
    const queued = await Promise.all([
      queueCompileJob(d.id, 1, 'solution', database), queueCompileJob(d.id, 1, 'solution', database),
    ]);
    expect(queued.map(r => r.kind).sort()).toEqual(['busy', 'queued']);
    const job = queued.find(r => r.kind === 'queued')!;
    if (job.kind !== 'queued') throw new Error('Expected job');
    await updateProblemDraft(d.id, 1, { solution_cpp: 'changed' }, database);
    await reconcileAuthoringJobs(spool, database);
    const claimed = await spool.claim();
    expect(claimed).toEqual(expect.objectContaining({ source: 'int main(){}', revision: 1, jobId: job.job.id }));
    await spool.complete(job.job.id, { version: 1, jobId: job.job.id, draftId: d.id, revision: 1,
      status: 'succeeded', errorCode: null, log: '', durationMs: 1, exitCode: 0 });
    await reconcileAuthoringJobs(spool, database);
    expect((await getAuthoringJob(job.job.id, database))?.status).toBe('stale');
    expect((await pool.query('SELECT status, revision FROM problem_drafts WHERE id=$1', [d.id])).rows[0])
      .toEqual({ status: 'draft', revision: 2 });
  });

  it('imports results exactly once and preserves a completed result on duplicate delivery', async () => {
    const d = await draft();
    const queued = await queueCompileJob(d.id, 1, 'solution', database);
    if (queued.kind !== 'queued') throw new Error('Expected queued');
    const result = { version: 1 as const, jobId: queued.job.id, draftId: d.id, revision: 1,
      status: 'succeeded' as const, errorCode: null, log: 'compiled', durationMs: 1, exitCode: 0 };
    await spool.complete(queued.job.id, result);
    expect(await applyJobResult(queued.job.id, result, database)).toBe(true);
    expect(await applyJobResult(queued.job.id, { ...result, log: 'duplicate' }, database)).toBe(false);
    expect((await getAuthoringJob(queued.job.id, database))?.log).toBe('compiled');
    await reconcileAuthoringJobs(spool, database);
    expect(await spool.readResult(queued.job.id)).toBeNull();
    expect((await queueCompileJob(d.id, 1, 'solution', database)).kind).toBe('queued');
  });

  it('records interrupted runner jobs and rejects mismatched result identities', async () => {
    const d = await draft();
    const queued = await queueCompileJob(d.id, 1, 'solution', database);
    if (queued.kind !== 'queued') throw new Error('Expected queued');
    await reconcileAuthoringJobs(spool, database);
    await spool.claim();
    await spool.recoverInterrupted();
    await reconcileAuthoringJobs(spool, database);
    expect(await getAuthoringJob(queued.job.id, database)).toEqual(expect.objectContaining({ status: 'failed', error_code: 'runner_interrupted' }));
    const second = await queueCompileJob(d.id, 1, 'solution', database);
    if (second.kind !== 'queued') throw new Error('Expected queued');
    await expect(applyJobResult(second.job.id, { version: 1, jobId: second.job.id, draftId: randomUUID(), revision: 1,
      status: 'succeeded', errorCode: null, log: '', durationMs: 1, exitCode: 0 }, database)).rejects.toThrow('identity');
    expect((await getAuthoringJob(second.job.id, database))?.status).toBe('queued');
  });

  it('times out abandoned jobs and rejects stale, empty, or published requests', async () => {
    const d = await draft();
    expect((await queueCompileJob(d.id, 2, 'solution', database)).kind).toBe('revision_conflict');
    expect((await queueCompileJob(d.id, 1, 'generator', database)).kind).toBe('source_missing');
    const queued = await queueCompileJob(d.id, 1, 'solution', database);
    if (queued.kind !== 'queued') throw new Error('Expected queued');
    await reconcileAuthoringJobs(spool, database, Date.now() + 16 * 60_000);
    expect((await getAuthoringJob(queued.job.id, database))?.status).toBe('timed_out');
    await pool.query("UPDATE problem_drafts SET status='published' WHERE id=$1", [d.id]);
    expect((await queueCompileJob(d.id, 1, 'solution', database)).kind).toBe('published');
  });

  it('rejects a malformed result durably and cleans its files without changing the draft', async () => {
    const d = await draft();
    const queued = await queueCompileJob(d.id, 1, 'solution', database);
    if (queued.kind !== 'queued') throw new Error('Expected queued');
    await writeFile(path.join(root, 'results', `${queued.job.id}.json`), '{broken');
    await reconcileAuthoringJobs(spool, database);
    expect(await getAuthoringJob(queued.job.id, database)).toEqual(expect.objectContaining({
      status: 'failed', error_code: 'invalid_runner_result', request_snapshot: null,
    }));
    expect(await spool.readResult(queued.job.id)).toBeNull();
    expect((await pool.query('SELECT revision, status FROM problem_drafts WHERE id=$1', [d.id])).rows[0])
      .toEqual({ revision: 1, status: 'draft' });
  });

  it('keeps result identity stable when a caller supplies an uppercase draft UUID', async () => {
    const d = await draft();
    const queued = await queueCompileJob(d.id.toUpperCase(), 1, 'solution', database);
    if (queued.kind !== 'queued') throw new Error('Expected queued');
    await reconcileAuthoringJobs(spool, database);
    const captured = await spool.claim();
    expect(captured?.draftId).toBe(d.id);
  });

  const testWithRunner = process.env.INTEGRATION_RUNNER_SPOOL ? it : it.skip;
  testWithRunner.each([
    ['solution', '#include <iostream>\nint main(){std::cout << 42;}', 'succeeded'],
    ['generator', 'int main(){deliberate_compile_error;}', 'failed'],
  ] as const)('runs an HTTP %s job through the network-isolated runner', async (target, source, status) => {
    const shared = new AuthoringSpool(process.env.INTEGRATION_RUNNER_SPOOL!);
    await shared.initialize();
    const d = await draft();
    await updateProblemDraft(d.id, 1, target === 'solution' ? { solution_cpp: source } : { generator_cpp: source }, database);
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'job-test', resave: false, saveUninitialized: false }));
    app.use((req, _res, next) => { req.session.userId = 1; req.session.role = 'admin'; next(); });
    app.use(createAuthoringJobRouter(true));
    app.use(errorHandler);
    const response = await request(app).post(`/admin/authoring/drafts/${d.id}/jobs/compile`).send({ expectedRevision: 2, target });
    expect(response.status).toBe(202);
    const deadline = Date.now() + 20_000;
    let job;
    do {
      await reconcileAuthoringJobs(shared, database);
      job = await getAuthoringJob(response.body.id, database);
      if (job && !['queued', 'compiling'].includes(job.status)) break;
      await delay(100);
    } while (Date.now() < deadline);
    expect(job?.status).toBe(status);
    const polled = await request(app).get(`/admin/authoring/jobs/${response.body.id}`);
    expect(polled.status).toBe(200);
    expect(polled.body.status).toBe(status);
    expect(polled.body.requestSnapshot).toBeUndefined();
    expect(polled.body.request_snapshot).toBeUndefined();
    expect(polled.body.source).toBeUndefined();
    expect(await shared.readResult(response.body.id)).toBeNull();
  });
});
