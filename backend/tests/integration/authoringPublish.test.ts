import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import unzipper from 'unzipper';
import { setTimeout as delay } from 'node:timers/promises';
import * as db from '../../db';
import draftRoutes from '../../controllers/authoringDraftController';
import problemRoutes from '../../controllers/problemController';
import { createAuthoringJobRouter } from '../../controllers/authoringJobController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { createProblemDraft, updateProblemDraft } from '../../services/authoringDraftQueryService';
import { applyJobResult, getAuthoringJob, queueVerifyJob } from '../../services/authoringJobQueryService';
import { mutateDraftTestcases } from '../../services/authoringTestcaseQueryService';
import { reconcileAuthoringJobs } from '../../services/authoringJobCoordinator';
import { AuthoringSpool } from '../../authoring/spool';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('transactional authoring publication', () => {
  const schema = `slice9_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const database = { pool, query: pool.query.bind(pool) };
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'publish-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.role = role; } next(); });
  app.use(draftRoutes); app.use(problemRoutes); app.use(createAuthoringJobRouter(true)); app.use(errorHandler);
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts,problems CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  const pdf = Buffer.from('%PDF-1.4\n%%EOF');
  const source = '// PRIVATE_SOLUTION\n#include <iostream>\nint main(){int n;if(std::cin>>n)std::cout<<n*2<<"\\n";}';
  async function draft(problemId = 'publish-test') {
    const d = await createProblemDraft({ problem_id: problemId, title: 'Publish test', author_profile_id: null,
      author_aka_name: 'AKA', author_real_name: 'Private real name', language: 'Thai', country_code: 'THA',
      category: null,
      time_limit_ms: 1000, memory_limit_mb: 256, created_by: null, solution_cpp: source,
      generator_cpp: '// PRIVATE_GENERATOR\nint main(){}', statement_html: '<h1>Publication</h1>' }, database);
    for (const [number, input, output] of [[2, '1\r\n', '\t2 \n'], [7, '', '']] as const) {
      await pool.query(`INSERT INTO problem_draft_testcases
        (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
        VALUES ($1,$2,$3,$4,$5,$6,'uploaded',1)`, [randomUUID(), d.id, number, `${number}.in`, input, output]);
    }
    return d;
  }
  const rows = async (table: 'problems' | 'testcases') => (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  const stored = async (id: string) => (await pool.query('SELECT * FROM problem_drafts WHERE id=$1', [id])).rows[0];
  const post = (id: string, revision = 1, role = 'admin') => request(app).post(`/admin/authoring/drafts/${id}/publish`)
    .set('x-test-role', role).send({ expectedRevision: revision });
  async function waitForBlockedPublish() {
    const deadline = Date.now() + 3000;
    do {
      const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND state='active'", [schema]);
      if (waiting.rows.length) return;
      await delay(10);
    } while (Date.now() < deadline);
    throw new Error('Publish did not wait on the competing transaction');
  }
  async function verify(d: Awaited<ReturnType<typeof draft>>, revision: number, artifact = pdf) {
    const queued = await queueVerifyJob(d.id, revision, database);
    if (queued.kind !== 'queued') throw new Error(queued.kind);
    const captured = queued.job.request_snapshot!;
    const bytes = Number((await pool.query(`SELECT COALESCE(SUM(octet_length(input_data) + octet_length(output_data)), 0)::text AS total
      FROM problem_draft_testcases WHERE draft_id=$1`, [d.id])).rows[0].total);
    await applyJobResult(queued.job.id, { version: 1, jobId: queued.job.id, draftId: d.id, revision,
      status: 'succeeded', errorCode: null, log: '', durationMs: 1, exitCode: 0,
      pdf: { sizeBytes: artifact.length, sha256: createHash('sha256').update(artifact).digest('hex'), templateVersion: 'red-gate-v1' },
      verification: { checks: { pdf: 'passed', solution: 'passed', generator: 'passed', execution: 'passed' },
        cases: captured.cases!.map(c => ({ caseId: c.caseId, caseNumber: c.caseNumber, durationMs: 1 })),
        caseCount: captured.cases!.length, totalTestcaseBytes: bytes, memoryLimitMb: 256, peakMemoryBytes: null, warnings: ['Peak RSS unavailable.'] } },
    database, undefined, async () => artifact);
  }
  async function ready(problemId?: string) {
    const d = await draft(problemId); await verify(d, 1);
    return d;
  }

  it('requires admin authentication and strict revision-only requests', async () => {
    const id = randomUUID();
    expect((await post(id, 1, '')).status).toBe(401);
    for (const role of ['user', 'staff']) expect((await post(id, 1, role)).status).toBe(403);
    for (const body of [{}, { expectedRevision: 0 }, { expectedRevision: 1, isVisible: true }]) {
      expect((await request(app).post(`/admin/authoring/drafts/${id}/publish`).set('x-test-role', 'admin').send(body)).status).toBe(400);
    }
    expect((await post(id)).body.code).toBe('draft_not_found');
  });

  it('publishes hidden legacy records with exact bytes and stable case numbers, keeping sources private', async () => {
    const d = await ready(); const response = await post(d.id);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({ draftId: d.id, problemId: 'publish-test', status: 'published', revision: 1, isVisible: false, caseCount: 2 }));
    const [problem] = await rows('problems');
    expect(problem).toEqual(expect.objectContaining({ id: 'publish-test', title: 'Publish test', author: 'AKA',
      time_limit_ms: 1000, memory_limit_mb: 256, is_visible: false, contest_id: null }));
    expect(problem.problem_pdf.equals(pdf)).toBe(true);
    expect((await rows('testcases')).map(c => [c.case_number, c.input_data, c.output_data])).toEqual([[2, '1\r\n', '\t2 \n'], [7, '', '']]);
    const published = await stored(d.id); expect(published.status).toBe('published'); expect(published.published_at).toBeInstanceOf(Date);
    expect(published.solution_cpp).toBe(source); expect(published.generator_cpp).toContain('PRIVATE_GENERATOR');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_');
    expect((await request(app).get('/problems')).body).toEqual([]);
    expect((await request(app).get('/problems/publish-test').set('x-test-role', 'user')).status).toBe(403);
    expect((await request(app).get('/problems/publish-test/pdf').set('x-test-role', 'user')).status).toBe(403);
    const detail = await request(app).get('/admin/problems/publish-test').set('x-test-role', 'admin');
    expect(detail.status).toBe(200); expect(detail.text).not.toContain('PRIVATE_');
    const exported = await request(app).post('/admin/problems/export').set('x-test-role', 'admin').send({ problemIds: ['publish-test'] })
      .buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.on('end', () => done(null, Buffer.concat(chunks))); });
    expect(exported.status).toBe(200); const zip = await unzipper.Open.buffer(exported.body);
    expect(zip.files.map(f => f.path).sort()).toEqual(['publish-test/config.json', 'publish-test/publish-test.pdf',
      'publish-test/testcases/input/input02.txt', 'publish-test/testcases/input/input07.txt',
      'publish-test/testcases/output/output02.txt', 'publish-test/testcases/output/output07.txt']);
    for (const file of zip.files) expect((await file.buffer()).toString()).not.toContain('PRIVATE_');
    expect((await post(d.id)).body.code).toBe('draft_published');
    expect((await updateProblemDraft(d.id, 1, { title: 'Edited' }, database)).kind).toBe('published');
    expect((await mutateDraftTestcases(d.id, 1, { kind: 'append', cases: [{ filename: 'new.in', input: '', output: '' }] }, database)).kind).toBe('published');
    expect((await queueVerifyJob(d.id, 1, database)).kind).toBe('published');
  });

  it('replaces the existing published problem only after the corrected statement verifies', async () => {
    const d = await ready();
    expect((await post(d.id)).status).toBe(201);
    const originallyPublished = await stored(d.id);
    const contest = (await pool.query(`INSERT INTO contests(title,description,start_time,end_time)
      VALUES ('Keep association','',NOW(),NOW() + INTERVAL '1 hour') RETURNING id`)).rows[0];
    await pool.query('UPDATE problems SET is_visible=true,contest_id=$2 WHERE id=$1', [d.problem_id, contest.id]);

    const saved = await updateProblemDraft(d.id, 1, { statement_html: '<h1>Corrected publication</h1>' }, database);
    expect(saved.kind).toBe('updated');
    if (saved.kind !== 'updated') throw new Error('Expected statement revision');
    const cases = await mutateDraftTestcases(d.id, 2, { kind: 'replace', cases: [
      { filename: 'replacement.in', input: '3\n', output: '6\n' },
    ] }, database);
    expect(cases).toEqual({ kind: 'saved', revision: 3 });
    const revisedPdf = Buffer.from('%PDF-1.4\nrevised\n%%EOF');
    await verify(d, 3, revisedPdf);

    const response = await post(d.id, 3);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ draftId: d.id, problemId: d.problem_id,
      status: 'published', revision: 3, isVisible: true, caseCount: 1 }));
    const [problem] = await rows('problems');
    expect(problem).toEqual(expect.objectContaining({ id: d.problem_id, is_visible: true, contest_id: contest.id }));
    expect(problem.problem_pdf.equals(revisedPdf)).toBe(true);
    expect((await rows('testcases')).map(c => [c.case_number, c.input_data, c.output_data])).toEqual([[1, '3\n', '6\n']]);
    const republished = await stored(d.id);
    expect(republished).toEqual(expect.objectContaining({ status: 'published', revision: 3 }));
    expect(republished.published_at.getTime()).toBe(originallyPublished.published_at.getTime());
  });

  it('refuses to overwrite a legacy row whose immutable publication metadata changed elsewhere', async () => {
    const d = await ready();
    expect((await post(d.id)).status).toBe(201);
    await pool.query("UPDATE problems SET title='Unrelated replacement' WHERE id=$1", [d.problem_id]);
    const saved = await updateProblemDraft(d.id, 1, { statement_html: '<h1>Correction</h1>' }, database);
    expect(saved.kind).toBe('updated');
    await verify(d, 2);

    const response = await post(d.id, 2);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('published_problem_mismatch');
    expect((await rows('problems'))[0]).toEqual(expect.objectContaining({ title: 'Unrelated replacement' }));
    expect((await stored(d.id)).status).toBe('ready');
  });

  it('updates changed authoring metadata when the original legacy publication is still intact', async () => {
    const d = await ready();
    expect((await post(d.id)).status).toBe(201);
    const statement = await updateProblemDraft(d.id, 1, { statement_html: '<h1>Correction</h1>' }, database);
    expect(statement.kind).toBe('updated');
    const metadata = await updateProblemDraft(d.id, 2, { title: 'Corrected title', time_limit_ms: 1500 }, database);
    expect(metadata.kind).toBe('updated');
    await verify(d, 3);

    expect((await post(d.id, 3)).status).toBe(200);
    expect((await rows('problems'))[0]).toEqual(expect.objectContaining({ title: 'Corrected title', time_limit_ms: 1500 }));
  });

  it('carries the draft category into the legacy problem and provenance, and detects out-of-band category edits', async () => {
    const d = await ready();
    await updateProblemDraft(d.id, 1, { category: 'Graph' }, database);
    await verify(d, 2);
    expect((await post(d.id, 2)).status).toBe(201);
    expect((await rows('problems'))[0]).toEqual(expect.objectContaining({ category: 'Graph' }));

    // A category edit made outside authoring must block the next republish,
    // like any other publication-metadata change.
    await pool.query("UPDATE problems SET category='Math' WHERE id=$1", [d.problem_id]);
    await updateProblemDraft(d.id, 2, { statement_html: '<h1>Correction</h1>' }, database);
    await verify(d, 3);
    const mismatch = await post(d.id, 3);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe('published_problem_mismatch');

    // Restoring the legacy category lets the republish through, and clearing
    // the draft category clears the problem's category on the next publish.
    await pool.query("UPDATE problems SET category='Graph' WHERE id=$1", [d.problem_id]);
    await updateProblemDraft(d.id, 3, { category: null }, database);
    await verify(d, 4);
    expect((await post(d.id, 4)).status).toBe(200);
    expect((await rows('problems'))[0].category).toBeNull();
  });

  it.each(['unverified', 'stale_revision', 'stale_verified_revision', 'stale_pdf', 'missing_pdf', 'corrupt_pdf', 'no_verification_job', 'incomplete_pair', 'empty_cases', 'busy'])(
    'rejects %s without creating any public record', async mode => {
      const d = await ready(); let revision = 1;
      if (mode === 'unverified') await pool.query("UPDATE problem_drafts SET status='generated',verified_revision=NULL WHERE id=$1", [d.id]);
      if (mode === 'stale_revision') revision = 2;
      if (mode === 'stale_verified_revision') await pool.query('UPDATE problem_drafts SET verified_revision=2 WHERE id=$1', [d.id]);
      if (mode === 'stale_pdf') await pool.query('UPDATE problem_drafts SET latest_pdf_revision=2 WHERE id=$1', [d.id]);
      if (mode === 'missing_pdf') await pool.query('UPDATE problem_drafts SET latest_pdf=NULL WHERE id=$1', [d.id]);
      if (mode === 'corrupt_pdf') await pool.query('UPDATE problem_drafts SET latest_pdf=$2 WHERE id=$1', [d.id, Buffer.from('%PDF-1.5\n%%EOF')]);
      if (mode === 'no_verification_job') await pool.query('DELETE FROM authoring_jobs WHERE draft_id=$1', [d.id]);
      if (mode === 'incomplete_pair') await pool.query('UPDATE problem_draft_testcases SET output_data=NULL WHERE draft_id=$1 AND case_number=7', [d.id]);
      if (mode === 'empty_cases') await pool.query('DELETE FROM problem_draft_testcases WHERE draft_id=$1', [d.id]);
      if (mode === 'busy') await pool.query("INSERT INTO authoring_jobs(id,draft_id,job_type,draft_revision) VALUES($1,$2,'compile_solution',1)", [randomUUID(), d.id]);
      expect((await post(d.id, revision)).status).toBe(409);
      expect(await rows('problems')).toEqual([]); expect(await rows('testcases')).toEqual([]);
      expect((await stored(d.id)).published_at).toBeNull();
    });

  it('does not overwrite an existing ID and leaves the losing draft ready', async () => {
    const d = await ready(); await pool.query("INSERT INTO problems(id,title,author,is_visible) VALUES('publish-test','Existing','Original',true)");
    expect((await post(d.id)).body.code).toBe('problem_id_conflict');
    expect((await rows('problems'))[0]).toEqual(expect.objectContaining({ title: 'Existing', author: 'Original', is_visible: true }));
    expect((await stored(d.id)).status).toBe('ready'); expect(await rows('testcases')).toEqual([]);
  });

  it('allows only one winner for concurrent publications of the same Problem ID', async () => {
    const a = await ready(); const b = await ready();
    const results = await Promise.all([post(a.id), post(b.id)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(results.find(r => r.status === 409)!.body.code).toBe('problem_id_conflict');
    expect(await rows('problems')).toHaveLength(1); expect(await rows('testcases')).toHaveLength(2);
    expect([(await stored(a.id)).status, (await stored(b.id)).status].sort()).toEqual(['published', 'ready']);
  });

  it('serializes duplicate Publish requests on the same draft', async () => {
    const d = await ready(); const results = await Promise.all([post(d.id), post(d.id)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(results.find(r => r.status === 409)!.body.code).toBe('draft_published');
    expect(await rows('testcases')).toHaveLength(2);
  });

  it('handles an uncommitted conflicting legacy problem insertion without overwriting it', async () => {
    const d = await ready(); const legacy = await pool.connect(); let pending: Promise<request.Response> | undefined;
    try {
      await legacy.query('BEGIN'); await legacy.query("INSERT INTO problems(id,title) VALUES('publish-test','Legacy wins')");
      pending = post(d.id).then(r => r);
      await waitForBlockedPublish(); await legacy.query('COMMIT');
      expect((await pending).body.code).toBe('problem_id_conflict');
      expect((await rows('problems'))[0].title).toBe('Legacy wins'); expect(await rows('testcases')).toEqual([]);
    } finally { await legacy.query('ROLLBACK'); legacy.release(); if (pending) await pending; }
  });

  it('rolls back problem and testcase writes when a later testcase insert fails', async () => {
    const d = await ready();
    await pool.query('ALTER TABLE testcases ADD CONSTRAINT fixture_failure CHECK(case_number<>7)');
    try {
      expect((await post(d.id)).status).toBe(500);
      expect(await rows('problems')).toEqual([]); expect(await rows('testcases')).toEqual([]);
      expect((await stored(d.id)).status).toBe('ready'); expect((await stored(d.id)).published_at).toBeNull();
    } finally { await pool.query('ALTER TABLE testcases DROP CONSTRAINT fixture_failure'); }
    expect((await post(d.id)).status).toBe(201);
  });

  it('rechecks revision after waiting for a concurrent Save holding the draft lock', async () => {
    const d = await ready(); const writer = await pool.connect(); let pending: Promise<request.Response> | undefined;
    try {
      await writer.query('BEGIN'); await writer.query('SELECT id FROM problem_drafts WHERE id=$1 FOR UPDATE', [d.id]);
      pending = post(d.id).then(r => r);
      await waitForBlockedPublish();
      await updateProblemDraft(d.id, 1, { title: 'Changed' }, { query: writer.query.bind(writer) });
      await writer.query('COMMIT');
      expect((await pending).body.code).toBe('revision_conflict');
      expect(await rows('problems')).toEqual([]);
    } finally { await writer.query('ROLLBACK'); writer.release(); if (pending) await pending; }
  });

  it('rolls back inserted legacy records if the final draft status change fails', async () => {
    const d = await ready();
    await pool.query("ALTER TABLE problem_drafts ADD CONSTRAINT fixture_publish_failure CHECK(status<>'published')");
    try {
      expect((await post(d.id)).status).toBe(500);
      expect(await rows('problems')).toEqual([]); expect(await rows('testcases')).toEqual([]);
      expect((await stored(d.id)).status).toBe('ready');
    } finally { await pool.query('ALTER TABLE problem_drafts DROP CONSTRAINT fixture_publish_failure'); }
    expect((await post(d.id)).status).toBe(201);
  });

  (process.env.INTEGRATION_RUNNER_SPOOL ? it : it.skip)('verifies through the real worker then publishes hidden through the API', async () => {
    const d = await draft('publish-e2e'); const shared = new AuthoringSpool(process.env.INTEGRATION_RUNNER_SPOOL!); await shared.initialize();
    const queued = await queueVerifyJob(d.id, 1, database); if (queued.kind !== 'queued') throw new Error(queued.kind);
    const deadline = Date.now() + 75_000; let job;
    do { await reconcileAuthoringJobs(shared, database); job = await getAuthoringJob(queued.job.id, database);
      if (job && !['queued', 'compiling', 'running'].includes(job.status)) break; await delay(100);
    } while (Date.now() < deadline);
    expect(job?.status).toBe('succeeded'); expect((await post(d.id)).status).toBe(201);
    const [problem] = await rows('problems'); expect(problem.is_visible).toBe(false);
    expect(problem.problem_pdf.subarray(0, 5).toString()).toBe('%PDF-'); expect(await rows('testcases')).toHaveLength(2);
  }, 90_000);
});
