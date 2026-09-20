import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import authorProfileRoutes from '../../controllers/authorProfileController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { createProblemDraft } from '../../services/authoringDraftQueryService';
import { getAuthoringJob, queueCompileJob } from '../../services/authoringJobQueryService';
import { reconcileAuthoringJobs } from '../../services/authoringJobCoordinator';
import {
  createProfileSync,
  getProfileSync,
  getProfileSyncImpact,
  PROFILE_SYNC,
} from '../../services/authoringProfileSyncService';
import { AuthoringSpool } from '../../authoring/spool';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('author profile auto-sync cascade', () => {
  const schema = `sync_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  let root: string;
  let spool: AuthoringSpool;
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'sync-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.role = role; } next(); });
  app.use(authorProfileRoutes); app.use(errorHandler);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts,problems,author_profiles CASCADE');
    root = await mkdtemp(path.join(os.tmpdir(), 'oj-sync-'));
    spool = new AuthoringSpool(root);
    await spool.initialize();
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const profileId = () => randomUUID();
  const pdfBytes = (suffix = '') => Buffer.from(`%PDF-1.4 sync${suffix}\n%%EOF`);
  async function createProfile(id = profileId(), aka = 'Original Aka') {
    await pool.query(`INSERT INTO author_profiles (id,aka_name,real_name,default_language,country_code)
      VALUES ($1,$2,'Real Name','Thai','THA')`, [id, aka]);
    return id;
  }
  const otherProfile = () => createProfile();
  async function createLinkedUser(id: number) {
    await pool.query(`INSERT INTO users (id,username,password_hash,role) VALUES ($1,$2,'x','user')`, [id, `user${id}`]);
  }
  async function linkedDraft(problemId: string, profileId: string, extra: { published?: boolean } = {}) {
    const d = await createProblemDraft({ problem_id: problemId, title: `${problemId} title`, author_profile_id: profileId,
      author_aka_name: 'Old Aka', author_real_name: 'Old Real', language: 'Thai', country_code: 'THA',
      categories: [],
      time_limit_ms: 1000, memory_limit_mb: 256, created_by: null, solution_cpp: 'int main(){}',
      statement_html: '<h1>Statement</h1>' }, database);
    if (extra.published) {
      await pool.query(`UPDATE problem_drafts SET status='published',published_at=NOW(),latest_pdf=$1,latest_pdf_revision=1 WHERE id=$2`,
        [pdfBytes('old'), d.id]);
      await pool.query(`INSERT INTO authoring_published_problems (draft_id,problem_id,title,author,time_limit_ms,memory_limit_mb)
        VALUES ($1,$2,$3,'Old Aka',1000,256)`, [d.id, problemId, `${problemId} title`]);
      await pool.query(`INSERT INTO problems (id,title,author,problem_pdf,time_limit_ms,memory_limit_mb,is_visible)
        VALUES ($1,$2,'Old Aka',$3,1000,256,true)`, [problemId, `${problemId} title`, pdfBytes('old')]);
    }
    return d;
  }

  /** Runs the coordinator until the spool has the given job, then completes it as a successful PDF. */
  async function completeSyncPdf(jobId: string, draftId: string, revision: number, content = pdfBytes('new')) {
    await reconcileAuthoringJobs(spool, database);
    await spool.claim();
    const { mkdir, writeFile } = require('node:fs/promises');
    await mkdir(path.join(root, 'artifacts', jobId), { recursive: true });
    await writeFile(path.join(root, 'artifacts', jobId, 'document.pdf'), content);
    await spool.complete(jobId, { version: 1, jobId, draftId, revision, status: 'succeeded',
      errorCode: null, log: '', durationMs: 1, exitCode: 0,
      pdf: { sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), templateVersion: 'red-gate-v1' } });
    await reconcileAuthoringJobs(spool, database);
  }

  it('counts linked drafts and published problems for the confirmation gate', async () => {
    const id = profileId();
    expect(await getProfileSyncImpact(id, database)).toEqual({ affectedDrafts: 0, affectedPublishedProblems: 0 });
    await createProfile(id);
    await createProfile(); // another profile — its drafts must not be counted
    await linkedDraft('IMP1', id);
    await linkedDraft('IMP2', id, { published: true });
    expect(await getProfileSyncImpact(id, database)).toEqual({ affectedDrafts: 2, affectedPublishedProblems: 1 });
  });

  it('updates a draft snapshot, rebuilds the PDF, and republishes a published problem', async () => {
    const id = await createProfile(profileId(), 'New Aka');
    const d = await linkedDraft('SYNC1', id, { published: true });

    const created = await createProfileSync(id, database);
    if (!('syncId' in created)) throw new Error(created.kind);
    expect(created.affectedDrafts).toBe(1);

    // First pass starts the item and queues the sync_pdf job.
    await reconcileAuthoringJobs(spool, database);
    const job = (await pool.query(`SELECT * FROM authoring_jobs WHERE draft_id=$1 AND job_type='sync_pdf'`, [d.id])).rows[0];
    expect(job).toBeTruthy();
    expect(job.draft_revision).toBe(2);

    const draftRow = (await pool.query('SELECT * FROM problem_drafts WHERE id=$1', [d.id])).rows[0];
    expect(draftRow.author_aka_name).toBe('New Aka');
    expect(draftRow.revision).toBe(2);
    expect(draftRow.status).toBe('published'); // stays published

    // Runner completes the PDF; import republishes the legacy problem.
    await completeSyncPdf(job.id, d.id, 2, pdfBytes('new'));

    const problem = (await pool.query('SELECT title,author,problem_pdf FROM problems WHERE id=$1', ['SYNC1'])).rows[0];
    expect(problem.author).toBe('New Aka');
    expect(problem.problem_pdf).toEqual(pdfBytes('new'));
    const item = (await pool.query('SELECT status FROM authoring_profile_sync_items WHERE draft_id=$1', [d.id])).rows[0];
    expect(item.status).toBe('synced');

    const run = await getProfileSync(created.syncId, database);
    expect(run?.status).toBe('succeeded');
    expect(run?.progress).toEqual({ total: 1, synced: 1, failed: 0 });
    // Provenance follows the new metadata.
    const provenance = (await pool.query('SELECT author FROM authoring_published_problems WHERE draft_id=$1', [d.id])).rows[0];
    expect(provenance.author).toBe('New Aka');
  });

  it('defers a draft that stays busy with another authoring job', async () => {
    const id = await createProfile(profileId(), 'New Aka');
    const d = await linkedDraft('SYNC2', id);

    // A compile job holds the draft for the whole cascade.
    const held = await queueCompileJob(d.id, 1, 'solution', database);
    if (held.kind !== 'queued') throw new Error(held.kind);

    const created = await createProfileSync(id, database);
    if (!('syncId' in created)) throw new Error(created.kind);

    // Simulate attempts running out: drive retries past MAX_ATTEMPTS.
    const now = Date.now();
    for (let attempt = 0; attempt < PROFILE_SYNC.MAX_ATTEMPTS + 1; attempt++) {
      await pool.query('UPDATE authoring_profile_sync_items SET next_attempt_at=NOW() WHERE sync_id=$1 AND status=$2',
        [created.syncId, 'pending']);
      await reconcileAuthoringJobs(spool, database, now + attempt * (PROFILE_SYNC.RETRY_DELAY_MS + 1));
    }
    const item = (await pool.query('SELECT status,error_message FROM authoring_profile_sync_items WHERE draft_id=$1', [d.id])).rows[0];
    expect(item.status).toBe('deferred');
    expect(item.error_message).toContain('busy');

    const run = await getProfileSync(created.syncId, database);
    expect(run?.status).toBe('succeeded'); // the run completes; the draft is deferred
    expect(run?.resultSummary).toEqual(expect.objectContaining({ synced: 0, deferred: 1 }));
    // The draft keeps its old snapshot and revision.
    const draftRow = (await pool.query('SELECT revision,author_aka_name FROM problem_drafts WHERE id=$1', [d.id])).rows[0];
    expect(draftRow).toEqual({ revision: 1, author_aka_name: 'Old Aka' });
    await failJob(held.job.id);
  });

  it('marks a failed PDF rebuild per draft while other drafts still sync', async () => {
    const id = await createProfile(profileId(), 'New Aka');
    const ok = await linkedDraft('SYNC3', id);
    const bad = await linkedDraft('SYNC4', id, { published: true });

    const created = await createProfileSync(id, database);
    if (!('syncId' in created)) throw new Error(created.kind);
    await reconcileAuthoringJobs(spool, database);

    const okJob = (await pool.query(`SELECT * FROM authoring_jobs WHERE draft_id=$1 AND job_type='sync_pdf'`, [ok.id])).rows[0];
    const badJob = (await pool.query(`SELECT * FROM authoring_jobs WHERE draft_id=$1 AND job_type='sync_pdf'`, [bad.id])).rows[0];

    // The good draft succeeds; the bad draft's render fails.
    await completeSyncPdf(okJob.id, ok.id, okJob.draft_revision, pdfBytes('new'));
    await reconcileAuthoringJobs(spool, database);
    await spool.claim();
    await spool.complete(badJob.id, { version: 1, jobId: badJob.id, draftId: bad.id, revision: badJob.draft_revision,
      status: 'failed', errorCode: 'pdf_render_error', log: '', durationMs: 1, exitCode: 1 });
    await reconcileAuthoringJobs(spool, database);

    const statuses = Object.fromEntries((await pool.query(
      'SELECT draft_id,status FROM authoring_profile_sync_items WHERE sync_id=$1', [created.syncId])).rows
      .map(r => [r.draft_id === ok.id ? 'ok' : 'bad', r.status]));
    expect(statuses).toEqual({ ok: 'synced', bad: 'failed' });

    // The failed published draft keeps its old PDF in the legacy problem row.
    const problem = (await pool.query('SELECT author,problem_pdf FROM problems WHERE id=$1', ['SYNC4'])).rows[0];
    expect(problem.author).toBe('Old Aka');
    expect(problem.problem_pdf).toEqual(pdfBytes('old'));

    const run = await getProfileSync(created.syncId, database);
    expect(run?.status).toBe('failed');
    expect(run?.progress).toEqual({ total: 2, synced: 1, failed: 1 });
  });

  it('is idempotent: re-running the sync with the same profile converges', async () => {
    const id = await createProfile(profileId(), 'New Aka');
    const d = await linkedDraft('SYNC5', id);

    const first = await createProfileSync(id, database);
    if (!('syncId' in first)) throw new Error(first.kind);
    await reconcileAuthoringJobs(spool, database);
    const job = (await pool.query(`SELECT * FROM authoring_jobs WHERE draft_id=$1 AND job_type='sync_pdf'`, [d.id])).rows[0];
    await completeSyncPdf(job.id, d.id, job.draft_revision, pdfBytes('new'));

    // Second run after the profile is unchanged converges to the same state.
    const second = await createProfileSync(id, database);
    if (!('syncId' in second)) throw new Error(second.kind);
    await reconcileAuthoringJobs(spool, database);
    const job2 = (await pool.query(`SELECT * FROM authoring_jobs WHERE draft_id=$1 AND job_type='sync_pdf' AND id<>$2`, [d.id, job.id])).rows[0];
    await completeSyncPdf(job2.id, d.id, job2.draft_revision, pdfBytes('new'));

    const draftRow = (await pool.query('SELECT author_aka_name,latest_pdf,revision FROM problem_drafts WHERE id=$1', [d.id])).rows[0];
    expect(draftRow.author_aka_name).toBe('New Aka');
    expect(draftRow.latest_pdf).toEqual(pdfBytes('new'));
    const run = await getProfileSync(second.syncId, database);
    expect(run?.status).toBe('succeeded');
  });

  it('confirms the two-phase profile update through the HTTP API', async () => {
    const id = await createProfile();
    await linkedDraft('SYNC6', id);

    // Unconfirmed author-relevant change reports impact and does not save.
    const gate = await request(app).patch(`/admin/author-profiles/${id}`).set('x-test-role', 'admin')
      .send({ akaName: 'Renamed' });
    expect(gate.status).toBe(200);
    expect(gate.body).toEqual(expect.objectContaining({
      confirmationRequired: true, affectedDrafts: 1, affectedPublishedProblems: 0,
    }));
    expect((await pool.query('SELECT aka_name FROM author_profiles WHERE id=$1', [id])).rows[0].aka_name).toBe('Original Aka');

    // Confirmed change saves and queues a cascade.
    const saved = await request(app).patch(`/admin/author-profiles/${id}`).set('x-test-role', 'admin')
      .send({ akaName: 'Renamed', confirmed: true });
    expect(saved.status).toBe(200);
    expect(saved.body.akaName).toBe('Renamed');
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM authoring_profile_syncs')).rows[0].count).toBe(1);

    // Non-author change saves without confirmation.
    await createLinkedUser(42);
    const linked = await request(app).patch(`/admin/author-profiles/${id}`).set('x-test-role', 'admin')
      .send({ userId: 42 });
    expect(linked.status).toBe(200);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM authoring_profile_syncs')).rows[0].count).toBe(1);
  });

  async function failJob(jobId: string) {
    await pool.query(`UPDATE authoring_jobs SET status='failed',error_code='test_done',
      finished_at=NOW(),request_snapshot=NULL WHERE id=$1`, [jobId]);
    await pool.query('DELETE FROM authoring_job_files WHERE job_id=$1', [jobId]);
  }
});
