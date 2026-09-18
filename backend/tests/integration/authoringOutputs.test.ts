import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { applyJobResult, getAuthoringJob, failAuthoringJob } from '../../services/authoringJobQueryService';
import { reconcileAuthoringJobs } from '../../services/authoringJobCoordinator';
import { AuthoringSpool } from '../../authoring/spool';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('atomic reference solution outputs', () => {
  const schema = `slice6_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  let root: string;
  let spool: AuthoringSpool;
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'output-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.role = 'admin'; next(); });
  app.use(createAuthoringJobRouter(true));
  app.use(errorHandler);
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts CASCADE');
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-output-jobs-'));
    spool = new AuthoringSpool(root); await spool.initialize();
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  async function draft() {
    const d = await createProblemDraft({ problem_id: 'outputs', title: 'Outputs', author_profile_id: null,
      author_aka_name: 'A', author_real_name: 'Author', language: 'Thai', country_code: 'THA',
      time_limit_ms: 1000, memory_limit_mb: 256, created_by: null,
      solution_cpp: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}' }, database);
    for (const n of [1, 2]) await pool.query(`INSERT INTO problem_draft_testcases
      (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1)`, [randomUUID(), d.id, n, `${n}.in`, `${n}\n`, `old${n}`, n === 1 ? 'uploaded' : 'generated']);
    return d;
  }
  const rows = async (id: string) => (await pool.query('SELECT * FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number', [id])).rows;
  async function queue(id: string, revision = 1) {
    const response = await request(app).post(`/admin/authoring/drafts/${id}/jobs/outputs`).send({ expectedRevision: revision });
    expect(response.status).toBe(202);
    expect(response.body.request_snapshot).toBeUndefined();
    return (await getAuthoringJob(response.body.id, database))!;
  }
  async function fixture() {
    const d = await draft(); const original = await rows(d.id); const job = await queue(d.id);
    const dir = path.join(root, 'outputs'); await mkdir(dir);
    await writeFile(path.join(dir, '1.in'), '2\n'); await writeFile(path.join(dir, '2.in'), '4\r\n');
    const files = await spool.storeInputs(job.id, dir);
    const outputs = files.map((a, i) => ({ ...a, caseId: original[i].id, caseNumber: i + 1, durationMs: 1 }));
    const result = { version: 1 as const, jobId: job.id, draftId: d.id, revision: 1,
      status: 'succeeded' as const, errorCode: null, log: '', durationMs: 2, exitCode: 0, outputs };
    return { d, original, job, result };
  }

  it('snapshots source and inputs durably and redelivers them after live inputs change', async () => {
    const d = await draft(); const job = await queue(d.id);
    await updateProblemDraft(d.id, 1, { solution_cpp: 'edited' }, database);
    await pool.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [d.id]);
    await reconcileAuthoringJobs(spool, database);
    const captured = await spool.claim();
    expect(captured?.source).toContain('n*2');
    expect(captured?.cases?.map(c => c.filename)).toEqual(['1.in', '2.in']);
    // Frozen input files are delivered independently of the live testcase rows.
    expect(await readFile(path.join(root, 'active', job.id, 'inputs', '0.txt'), 'utf8')).toBe('1\n');
    expect(await readFile(path.join(root, 'active', job.id, 'inputs', '1.txt'), 'utf8')).toBe('2\n');
  });

  it('requires stored inputs, source, compatible resource limits and an unchanged revision', async () => {
    const d = await draft();
    const post = (revision = 1) => request(app).post(`/admin/authoring/drafts/${d.id}/jobs/outputs`).send({ expectedRevision: revision });
    expect((await post(2)).body.code).toBe('revision_conflict');
    await pool.query('UPDATE problem_drafts SET memory_limit_mb=1024 WHERE id=$1', [d.id]);
    expect((await post()).body.code).toBe('unsupported_resource_limits');
    await pool.query("UPDATE problem_drafts SET memory_limit_mb=256,solution_cpp='' WHERE id=$1", [d.id]);
    expect((await post()).body.code).toBe('source_missing');
    await pool.query("UPDATE problem_drafts SET solution_cpp='int main(){}' WHERE id=$1", [d.id]);
    await pool.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [d.id]);
    expect((await post()).body.code).toBe('inputs_missing');
  });

  it('atomically replaces all outputs while preserving input identity, order and provenance', async () => {
    const { d, original, job, result } = await fixture();
    await spool.complete(job.id, result); await reconcileAuthoringJobs(spool, database);
    const actual = await rows(d.id);
    expect(actual.map(c => c.output_data)).toEqual(['2\n', '4\r\n']);
    expect(actual.map(c => [c.id, c.input_data, c.source, c.source_revision]))
      .toEqual(original.map(c => [c.id, c.input_data, c.source, c.source_revision]));
    expect((await pool.query('SELECT revision,status,verified_revision FROM problem_drafts WHERE id=$1', [d.id])).rows[0])
      .toEqual({ revision: 1, status: 'generated', verified_revision: null });
    expect((await getAuthoringJob(job.id, database))?.result_summary).toEqual(expect.objectContaining({ caseCount: 2, outputs: result.outputs }));
    expect((await pool.query('SELECT * FROM authoring_job_inputs WHERE job_id=$1', [job.id])).rows).toEqual([]);
    expect(await applyJobResult(job.id, result, database)).toBe(false);
    expect(await spool.jobIds()).not.toContain(job.id);
  });

  it.each(['failed', 'corrupted', 'missing_case', 'wrong_case', 'stale', 'expired'])(
    'preserves every previous output on %s and releases snapshot storage', async mode => {
      const { d, original, job, result } = await fixture();
      let terminal: unknown = result;
      if (mode === 'failed') terminal = { ...result, outputs: undefined, status: 'failed', exitCode: 1,
        errorCode: 'solution_runtime_error', failedCase: { caseId: original[1].id, caseNumber: 2, durationMs: 1 } };
      if (mode === 'corrupted') await writeFile(path.join(root, 'artifacts', job.id, '1.txt'), 'BAD');
      if (mode === 'missing_case') terminal = { ...result, outputs: result.outputs.slice(0, 1) };
      if (mode === 'wrong_case') terminal = { ...result, outputs: result.outputs.map((c, i) => i ? { ...c, caseId: randomUUID() } : c) };
      if (mode === 'stale') await updateProblemDraft(d.id, 1, { title: 'Edited' }, database);
      if (mode === 'expired') await failAuthoringJob(job.id, 'job_expired', true, database);
      await spool.complete(job.id, terminal as typeof result); await reconcileAuthoringJobs(spool, database);
      expect((await rows(d.id)).map(c => c.output_data)).toEqual(original.map(c => c.output_data));
      expect((await getAuthoringJob(job.id, database))?.status).toBe(mode === 'stale' ? 'stale' : mode === 'expired' ? 'timed_out' : 'failed');
      expect((await pool.query('SELECT * FROM authoring_job_inputs WHERE job_id=$1', [job.id])).rows).toEqual([]);
    });

  it('rolls back earlier output updates if the job expires while the last artifact is imported', async () => {
    const { d, original, job, result } = await fixture();
    const applied = await applyJobResult(job.id, result, database, async (index, artifact) => {
      if (index === 1) await failAuthoringJob(job.id, 'job_expired', true, database);
      return spool.readOutput(job.id, index, artifact);
    });
    expect(applied).toBe(false);
    expect((await rows(d.id)).map(c => c.output_data)).toEqual(original.map(c => c.output_data));
    expect((await getAuthoringJob(job.id, database))?.status).toBe('timed_out');
    expect((await pool.query('SELECT * FROM authoring_job_inputs WHERE job_id=$1', [job.id])).rows).toEqual([]);
  });

  (process.env.INTEGRATION_RUNNER_SPOOL ? it : it.skip)('runs mixed manual/generated inputs through HTTP and the isolated runner without a generator', async () => {
    const shared = new AuthoringSpool(process.env.INTEGRATION_RUNNER_SPOOL!); await shared.initialize();
    const d = await draft(); const queued = await queue(d.id);
    let job; const deadline = Date.now() + 25_000;
    do {
      await reconcileAuthoringJobs(shared, database); job = await getAuthoringJob(queued.id, database);
      if (job && !['queued', 'compiling', 'running'].includes(job.status)) break;
      await delay(100);
    } while (Date.now() < deadline);
    expect(job).toEqual(expect.objectContaining({ status: 'succeeded' }));
    expect((await rows(d.id)).map(c => c.output_data)).toEqual(['2\n', '4\n']);
    expect(await shared.jobIds()).not.toContain(queued.id);
  });
});
