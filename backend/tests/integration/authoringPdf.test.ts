import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
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
(databaseUrl ? describe : describe.skip)('versioned PDF authoring jobs', () => {
  const schema = `slice7_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  let root: string; let spool: AuthoringSpool; let avatar: Buffer;
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'pdf-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.role = 'admin'; next(); });
  app.use(createAuthoringJobRouter(true)); app.use(errorHandler);
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool);
    avatar = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#084a85' } }).png().toBuffer();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts CASCADE');
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-pdf-')); spool = new AuthoringSpool(root); await spool.initialize();
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  async function draft() {
    const d = await createProblemDraft({ problem_id: 'pdf-test', title: 'PDF test', author_profile_id: null,
      author_aka_name: 'ผู้เขียน', author_real_name: 'Author', language: 'Thai', country_code: 'THA',
      time_limit_ms: 1000, memory_limit_mb: 256, created_by: null, solution_cpp: '',
      statement_html: '<h1>โจทย์ใหม่</h1><p>สมการ $x^2$</p><img src="{{ASSET_BASE}}/diagram.png" style="width:80%">' }, database);
    await pool.query('UPDATE problem_drafts SET author_profile_image_png=$1 WHERE id=$2', [avatar, d.id]);
    await pool.query(`INSERT INTO problem_draft_assets (id,draft_id,filename,mime_type,content,checksum_sha256,size_bytes)
      VALUES ($1,$2,'diagram.png','image/png',$3,$4,$5)`, [randomUUID(), d.id, avatar, createHash('sha256').update(avatar).digest('hex'), avatar.length]);
    return d;
  }
  const post = (id: string, revision = 1) => request(app).post(`/admin/authoring/drafts/${id}/jobs/pdf`).send({ expectedRevision: revision });
  async function queue(id: string) { const response = await post(id); expect(response.status).toBe(202); return (await getAuthoringJob(response.body.id, database))!; }
  const stored = async (id: string) => (await pool.query('SELECT latest_pdf,latest_pdf_revision,revision,status FROM problem_drafts WHERE id=$1', [id])).rows[0];

  it('captures metadata, sanitized statement, avatar and asset bytes independently of later edits', async () => {
    const d = await draft(); const job = await queue(d.id);
    expect(job.request_snapshot?.source).toBe('');
    expect(job.request_snapshot?.pdf?.document.title).toBe('PDF test');
    await updateProblemDraft(d.id, 1, { title: 'Changed', statement_html: 'changed', author_profile_image_png: null }, database);
    await pool.query('DELETE FROM problem_draft_assets WHERE draft_id=$1', [d.id]);
    await reconcileAuthoringJobs(spool, database); const captured = await spool.claim();
    expect(captured?.pdf?.document.statementHtml).toContain('โจทย์ใหม่');
    expect(await readFile(path.join(root, 'active', job.id, 'pdf', 'avatar.png'))).toEqual(avatar);
    expect(await readFile(path.join(root, 'active', job.id, 'pdf', 'assets', 'diagram.png'))).toEqual(avatar);
  });

  it('rejects unsafe HTML, missing references, unsupported template and stale revision before queueing', async () => {
    const d = await draft(); expect((await post(d.id, 2)).body.code).toBe('revision_conflict');
    for (const html of ['<script>alert(1)</script>', '<img src="{{ASSET_BASE}}/missing.png">', '<img src="https://example.org/a.png">']) {
      await pool.query('UPDATE problem_drafts SET statement_html=$1 WHERE id=$2', [html, d.id]);
      expect((await post(d.id)).body.code).toBe('invalid_statement');
    }
    await pool.query("UPDATE problem_drafts SET template_version='unknown' WHERE id=$1", [d.id]);
    expect((await post(d.id)).body.code).toBe('unsupported_template');
    expect((await pool.query('SELECT * FROM authoring_jobs')).rows).toHaveLength(0);
  });

  // A real minimal PDF fixture is used; no renderer is needed for transactional import tests.
  const fixturePdf = () => readFile(path.join(__dirname, '../fixtures/pdf/red-gate-demo.pdf'));
  async function completed() {
    const d = await draft(); const job = await queue(d.id); const pdf = await fixturePdf();
    const { mkdir } = require('node:fs/promises');
    await mkdir(path.join(root, 'artifacts', job.id)); await writeFile(path.join(root, 'artifacts', job.id, 'document.pdf'), pdf);
    const result = { version: 1 as const, jobId: job.id, draftId: d.id, revision: 1,
      status: 'succeeded' as const, errorCode: null, log: '', durationMs: 1, exitCode: 0,
      pdf: { sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), templateVersion: 'red-gate-v1' as const } };
    return { d, job, pdf, result };
  }
  it('imports one successful PDF and exposes a private, non-cached inline preview with revision headers', async () => {
    const { d, job, pdf, result } = await completed();
    await spool.complete(job.id, result); await reconcileAuthoringJobs(spool, database);
    expect(await stored(d.id)).toEqual({ latest_pdf: pdf, latest_pdf_revision: 1, revision: 1, status: 'generated' });
    const download = await request(app).get(`/admin/authoring/drafts/${d.id}/pdf`);
    expect(download.status).toBe(200); expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['cache-control']).toContain('no-store'); expect(download.headers['x-pdf-revision']).toBe('1');
    expect(download.headers['content-disposition']).toContain('inline');
    expect((await pool.query('SELECT * FROM authoring_job_files WHERE job_id=$1', [job.id])).rows).toHaveLength(0);
    expect(await applyJobResult(job.id, result, database)).toBe(false);
  });

  it.each(['failure', 'stale', 'corrupt', 'wrong_template', 'no_manifest', 'expired'])('preserves the last PDF on %s', async mode => {
    const { d, job, result } = await completed();
    await pool.query("UPDATE problem_drafts SET latest_pdf=$1,latest_pdf_revision=1 WHERE id=$2", [Buffer.from('old'), d.id]);
    let terminal: any = result;
    if (mode === 'failure') terminal = { ...result, status: 'failed', errorCode: 'pdf_render_error', exitCode: 1, pdf: undefined };
    if (mode === 'stale') await updateProblemDraft(d.id, 1, { title: 'Changed' }, database);
    if (mode === 'corrupt') await writeFile(path.join(root, 'artifacts', job.id, 'document.pdf'), 'BAD');
    if (mode === 'wrong_template') terminal = { ...result, pdf: { ...result.pdf, templateVersion: 'unknown' } };
    if (mode === 'no_manifest') terminal = { ...result, pdf: undefined };
    if (mode === 'expired') await failAuthoringJob(job.id, 'job_expired', true, database);
    if (mode === 'wrong_template') await writeFile(path.join(root, 'results', `${job.id}.json`), JSON.stringify(terminal));
    else await spool.complete(job.id, terminal);
    await reconcileAuthoringJobs(spool, database);
    expect((await stored(d.id)).latest_pdf).toEqual(Buffer.from('old'));
    expect((await getAuthoringJob(job.id, database))?.status).toBe(mode === 'stale' ? 'stale' : mode === 'expired' ? 'timed_out' : 'failed');
    expect((await pool.query('SELECT * FROM authoring_job_files WHERE job_id=$1', [job.id])).rows).toHaveLength(0);
  });

  it('rolls back PDF replacement when a terminal transition wins during artifact reading', async () => {
    const { d, job, result } = await completed();
    await pool.query('UPDATE problem_drafts SET latest_pdf=$1,latest_pdf_revision=1 WHERE id=$2', [Buffer.from('old'), d.id]);
    const applied = await applyJobResult(job.id, result, database, undefined, async artifact => {
      await failAuthoringJob(job.id, 'job_expired', true, database);
      return spool.readPdf(job.id, artifact);
    });
    expect(applied).toBe(false); expect((await stored(d.id)).latest_pdf).toEqual(Buffer.from('old'));
    expect((await getAuthoringJob(job.id, database))?.status).toBe('timed_out');
    expect((await pool.query('SELECT * FROM authoring_job_files WHERE job_id=$1', [job.id])).rows).toHaveLength(0);
  });

  it('creates a captured PNG fallback when the draft has no author image and reports missing PDFs', async () => {
    const d = await draft(); await pool.query('UPDATE problem_drafts SET author_profile_image_png=NULL WHERE id=$1', [d.id]);
    expect((await request(app).get(`/admin/authoring/drafts/${d.id}/pdf`)).body.code).toBe('pdf_missing');
    const job = await queue(d.id); await reconcileAuthoringJobs(spool, database); await spool.claim();
    const captured = await spool.readPdfInput(job.id, job.request_snapshot!.pdf!.avatar, true);
    expect((await sharp(captured).metadata()).format).toBe('png');
    expect((await sharp(captured).metadata()).width).toBe(512);
  });

  (process.env.INTEGRATION_RUNNER_SPOOL ? it : it.skip)('builds an actual Thai/math/image PDF through the isolated worker without C++ sources', async () => {
    const shared = new AuthoringSpool(process.env.INTEGRATION_RUNNER_SPOOL!); await shared.initialize();
    const d = await draft(); const queued = await queue(d.id); const deadline = Date.now() + 70_000; let job;
    do { await reconcileAuthoringJobs(shared, database); job = await getAuthoringJob(queued.id, database);
      if (job && !['queued', 'compiling', 'running'].includes(job.status)) break; await delay(100);
    } while (Date.now() < deadline);
    expect(job).toEqual(expect.objectContaining({ status: 'succeeded' }));
    expect((await stored(d.id)).latest_pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await stored(d.id)).latest_pdf_revision).toBe(1);
  }, 80_000);
});
