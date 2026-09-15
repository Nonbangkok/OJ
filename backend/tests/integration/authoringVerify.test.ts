import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
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
import { getAuthoringJob, applyJobResult, failAuthoringJob } from '../../services/authoringJobQueryService';
import { reconcileAuthoringJobs } from '../../services/authoringJobCoordinator';
import { AuthoringSpool } from '../../authoring/spool';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('mechanical verification and readiness', () => {
  const schema = `slice8_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  let root: string; let spool: AuthoringSpool;
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'verify-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.role = 'admin'; next(); });
  app.use(createAuthoringJobRouter(true)); app.use(errorHandler);
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts CASCADE');
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-verify-')); spool = new AuthoringSpool(root); await spool.initialize();
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  async function draft(generator: string | null = null) {
    const d = await createProblemDraft({ problem_id: 'verify-test', title: 'Verify test', author_profile_id: null,
      author_aka_name: 'A', author_real_name: 'Author', language: 'Thai', country_code: 'THA',
      time_limit_ms: 1000, memory_limit_mb: 256, created_by: null,
      solution_cpp: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}',
      generator_cpp: generator, statement_html: '<h1>Verify</h1><p>$x^2$</p>' }, database);
    for (const n of [1, 2]) await pool.query(`INSERT INTO problem_draft_testcases
      (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
      VALUES ($1,$2,$3,$4,$5,$6,'uploaded',1)`, [randomUUID(), d.id, n, `${n}.in`, `${n}\n`, `${n*2}\r\n`]);
    return d;
  }
  const post = (id: string, revision = 1) => request(app).post(`/admin/authoring/drafts/${id}/jobs/verify`).send({ expectedRevision: revision });
  async function queue(id: string) {
    const response = await post(id); expect(response.status).toBe(202);
    expect(response.body.request_snapshot).toBeUndefined();
    return (await getAuthoringJob(response.body.id, database))!;
  }
  const stored = async (id: string) => (await pool.query('SELECT latest_pdf,latest_pdf_revision,revision,verified_revision,status FROM problem_drafts WHERE id=$1', [id])).rows[0];
  const cases = async (id: string) => (await pool.query('SELECT * FROM problem_draft_testcases WHERE draft_id=$1 ORDER BY case_number', [id])).rows;
  const snapshots = async (id: string) => Number((await pool.query(`SELECT
    (SELECT count(*) FROM authoring_job_files WHERE job_id=$1) +
    (SELECT count(*) FROM authoring_job_inputs WHERE job_id=$1) AS count`, [id])).rows[0].count);

  it('captures solution, optional generator and expected outputs without mutating testcase pairs', async () => {
    const d = await draft('int main(){return 0;}'); const original = await cases(d.id); const job = await queue(d.id);
    const snapshot = job.request_snapshot as any;
    expect(snapshot.kind).toBe('verify_all'); expect(snapshot.source).toContain('n*2');
    expect(snapshot.generatorSource).toBe('int main(){return 0;}');
    expect(snapshot.expectedOutputs.map((c: any) => c.sizeBytes)).toEqual([3, 3]);
    expect(await cases(d.id)).toEqual(original);
    await updateProblemDraft(d.id, 1, { solution_cpp: 'edited', generator_cpp: null }, database);
    await pool.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [d.id]);
    await reconcileAuthoringJobs(spool, database); const captured: any = await spool.claim();
    expect(captured.source).toContain('n*2');
    expect(await (spool as any).readJobExpectedOutput(job.id, 0, captured.expectedOutputs[0])).toBe('2\r\n');
    expect(await spool.readJobInput(job.id, 1, captured.cases[1])).toBe('2\n');
  });

  it('rejects incomplete pairs, invalid metadata/HTML and unsupported limits before queueing', async () => {
    const d = await draft(); expect((await post(d.id, 2)).body.code).toBe('revision_conflict');
    for (const [sql, code] of [
      ["UPDATE problem_drafts SET title=' ' WHERE id=$1", 'invalid_metadata'],
      ["UPDATE problem_drafts SET title='Title',statement_html='<script>x</script>' WHERE id=$1", 'invalid_statement'],
      ["UPDATE problem_drafts SET statement_html='<p>OK</p>',memory_limit_mb=1024 WHERE id=$1", 'unsupported_resource_limits'],
      ["UPDATE problem_drafts SET memory_limit_mb=256,solution_cpp='' WHERE id=$1", 'source_missing'],
    ]) { await pool.query(sql, [d.id]); expect((await post(d.id)).body.code).toBe(code); }
    await pool.query("UPDATE problem_drafts SET solution_cpp='int main(){}' WHERE id=$1", [d.id]);
    await pool.query('UPDATE problem_draft_testcases SET output_data=NULL WHERE draft_id=$1 AND case_number=2', [d.id]);
    expect((await post(d.id)).body.code).toBe('outputs_missing');
    await pool.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [d.id]);
    expect((await post(d.id)).body.code).toBe('inputs_missing');
    expect((await pool.query('SELECT * FROM authoring_jobs')).rows).toEqual([]);
  });

  async function completed() {
    const d = await draft(); const original = await cases(d.id); const job = await queue(d.id);
    const pdf = await readFile(path.join(__dirname, '../fixtures/pdf/red-gate-demo.pdf'));
    await mkdir(path.join(root, 'artifacts', job.id)); await writeFile(path.join(root, 'artifacts', job.id, 'document.pdf'), pdf);
    const result: any = { version: 1, jobId: job.id, draftId: d.id, revision: 1, status: 'succeeded', errorCode: null,
      log: 'Verification complete', durationMs: 10, exitCode: 0,
      pdf: { sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), templateVersion: 'red-gate-v1' },
      verification: { checks: { pdf: 'passed', solution: 'passed', generator: 'skipped', execution: 'passed' },
        cases: original.map(c => ({ caseId: c.id, caseNumber: c.case_number, durationMs: 1 })),
        caseCount: 2, totalTestcaseBytes: 10, memoryLimitMb: 256, peakMemoryBytes: null, warnings: ['Peak RSS is not measured.'] } };
    return { d, job, pdf, result, original };
  }
  it('atomically installs a verified PDF and readies only that revision without rewriting cases', async () => {
    const { d, job, pdf, result, original } = await completed();
    await spool.complete(job.id, result); await reconcileAuthoringJobs(spool, database);
    expect(await stored(d.id)).toEqual({ latest_pdf: pdf, latest_pdf_revision: 1, revision: 1, verified_revision: 1, status: 'ready' });
    expect(await cases(d.id)).toEqual(original); expect(await snapshots(job.id)).toBe(0);
    const terminal = await getAuthoringJob(job.id, database);
    expect(terminal?.result_summary).toEqual(expect.objectContaining({ verifiedRevision: 1 }));
    expect(await applyJobResult(job.id, result, database)).toBe(false);
    expect(await spool.jobIds()).not.toContain(job.id);
    await updateProblemDraft(d.id, 1, { title: 'Edited' }, database);
    expect(await stored(d.id)).toEqual(expect.objectContaining({ revision: 2, verified_revision: null, status: 'draft', latest_pdf: pdf }));
  });

  it.each(['failure', 'stale', 'corrupt_pdf', 'missing_case', 'wrong_case', 'wrong_count', 'wrong_size', 'missing_pdf', 'missing_report', 'expired'])(
    'cannot become ready or replace artifacts on %s', async mode => {
      const { d, job, result, original } = await completed();
      await pool.query('UPDATE problem_drafts SET latest_pdf=$1,latest_pdf_revision=1 WHERE id=$2', [Buffer.from('old'), d.id]);
      if (mode === 'failure') Object.assign(result, { status: 'failed', errorCode: 'wrong_answer', pdf: undefined,
        failedCase: result.verification.cases[0], verification: { ...result.verification, checks: { ...result.verification.checks, execution: 'failed' }, cases: [] } });
      if (mode === 'stale') await updateProblemDraft(d.id, 1, { title: 'Changed' }, database);
      if (mode === 'corrupt_pdf') await writeFile(path.join(root, 'artifacts', job.id, 'document.pdf'), 'BAD');
      if (mode === 'missing_case') result.verification.cases.pop();
      if (mode === 'wrong_case') result.verification.cases[0].caseId = randomUUID();
      if (mode === 'wrong_count') result.verification.caseCount = 1;
      if (mode === 'wrong_size') result.verification.totalTestcaseBytes = 9;
      if (mode === 'missing_pdf') delete result.pdf;
      if (mode === 'missing_report') delete result.verification;
      if (mode === 'expired') await failAuthoringJob(job.id, 'job_expired', true, database);
      // Deliberately corrupt transport fixtures must reach reconciliation, even if strict schemas reject them.
      await writeFile(path.join(root, 'results', `${job.id}.json`), JSON.stringify(result));
      await reconcileAuthoringJobs(spool, database);
      expect(await stored(d.id)).toEqual(expect.objectContaining({ latest_pdf: Buffer.from('old'), verified_revision: null }));
      expect((await stored(d.id)).status).not.toBe('ready'); expect(await cases(d.id)).toEqual(original);
      expect((await getAuthoringJob(job.id, database))?.status).toBe(mode === 'stale' ? 'stale' : mode === 'expired' ? 'timed_out' : 'failed');
      expect(await snapshots(job.id)).toBe(0);
    });

  it('rolls back readiness and PDF if expiry wins while the artifact is being imported', async () => {
    const { d, job, result } = await completed();
    expect(await applyJobResult(job.id, result, database, undefined, async artifact => {
      await failAuthoringJob(job.id, 'job_expired', true, database); return spool.readPdf(job.id, artifact);
    })).toBe(false);
    expect(await stored(d.id)).toEqual(expect.objectContaining({ status: 'draft', latest_pdf: null, verified_revision: null }));
    expect(await snapshots(job.id)).toBe(0);
  });

  it('does not install readiness when the deadline passes during PDF reading without a competing expiry worker', async () => {
    const { d, job, result } = await completed();
    // Begin with a live deadline, then consume the remaining time inside artifact I/O.
    const deadline = new Date(Date.now() + 1000).toISOString();
    await pool.query("UPDATE authoring_jobs SET request_snapshot=jsonb_set(request_snapshot,'{deadline}',to_jsonb($2::text)) WHERE id=$1", [job.id, deadline]);
    let readStarted = false;
    await applyJobResult(job.id, result, database, undefined, async artifact => {
      readStarted = true;
      await delay(Math.max(0, Date.parse(deadline) - Date.now()) + 50);
      return spool.readPdf(job.id, artifact);
    });
    expect(readStarted).toBe(true);
    const final = await stored(d.id);
    expect(final.status).toBe('draft'); expect(final.verified_revision).toBeNull(); expect(final.latest_pdf).toBeNull();
    expect((await getAuthoringJob(job.id, database))?.status).toBe('timed_out');
    expect(await snapshots(job.id)).toBe(0);
  });

  (process.env.INTEGRATION_RUNNER_SPOOL ? it : it.skip)('verifies and rejects real outputs through HTTP, PostgreSQL and the isolated worker', async () => {
    const shared = new AuthoringSpool(process.env.INTEGRATION_RUNNER_SPOOL!); await shared.initialize();
    const d = await draft('int main(){return 0;}');
    const wait = async () => {
      const queued = await queue(d.id); const deadline = Date.now() + 75_000; let job;
      do { await reconcileAuthoringJobs(shared, database); job = await getAuthoringJob(queued.id, database);
        if (job && !['queued', 'compiling', 'running'].includes(job.status)) return job; await delay(100);
      } while (Date.now() < deadline); throw new Error('Verify worker did not finish');
    };
    const original = await cases(d.id); const passed = await wait();
    expect(passed.status).toBe('succeeded'); expect((await stored(d.id)).status).toBe('ready');
    expect(await cases(d.id)).toEqual(original);
    // Corrupt an expected answer in this isolated fixture; Verify must never overwrite it to force a pass.
    await pool.query("UPDATE problem_draft_testcases SET output_data='WRONG' WHERE draft_id=$1 AND case_number=2", [d.id]);
    const failed = await wait(); expect(failed.error_code).toBe('wrong_answer'); expect(failed.status).toBe('failed');
    expect((await stored(d.id)).status).not.toBe('ready');
    expect((await cases(d.id))[1].output_data).toBe('WRONG');
  }, 160_000);
});
