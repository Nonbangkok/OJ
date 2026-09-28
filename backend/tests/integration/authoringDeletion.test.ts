import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import pg from 'pg';
import request from 'supertest';
import * as db from '../../db';
import draftRoutes from '../../controllers/authoringDraftController';
import profileRoutes from '../../controllers/authorProfileController';
import { createAuthoringJobRouter } from '../../controllers/authoringJobController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import {
  createProblemDraft,
  updateProblemDraft,
} from '../../services/authoringDraftQueryService';
import { applyJobResult, queueVerifyJob } from '../../services/authoringJobQueryService';
import { publishProblemDraft } from '../../services/authoringPublishService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('authoring draft and author profile deletion', () => {
  const schema = `slicedel_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'delete-test', resave: false, saveUninitialized: false }));
  // Auth guards read only `req.user` (populated by attachRequestUser in the
  // real app), so the test harness sets it directly.
  app.use((req, _res, next) => {
    const role = req.header('x-test-role');
    if (role === 'admin' || role === 'staff' || role === 'user') {
      req.user = { id: 1, username: 'user1', role, hasAvatar: false };
    }
    next();
  });
  app.use(draftRoutes);
  app.use(profileRoutes);
  app.use(createAuthoringJobRouter(true));
  app.use(errorHandler);

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await runMigrationsFromPool(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts, problems, author_profiles, authoring_profile_syncs CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  const pdf = Buffer.from('%PDF-1.4\n%%EOF');
  const source = '#include <iostream>\nint main(){int n;if(std::cin>>n)std::cout<<n*2<<"\\n";}';

  const count = async (table: string, where = '', params: unknown[] = []) =>
    Number((await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} ${where}`, params)).rows[0].count);

  async function createProfile(akaName = 'Delete Me') {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO author_profiles (id, aka_name, real_name, default_language, country_code) VALUES ($1,$2,$3,$4,$5)',
      [id, akaName, 'Real Name', 'Thai', 'THA'],
    );
    return id;
  }

  async function createDraft(problemId: string, profileId: string | null = null) {
    return createProblemDraft({
      problem_id: problemId,
      title: `Deletion test ${problemId}`,
      author_profile_id: profileId,
      author_aka_name: 'AKA Author',
      author_real_name: 'Real Author',
      language: 'Thai',
      country_code: 'THA',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 256,
      created_by: null,
      solution_cpp: source,
      generator_cpp: null,
      statement_html: '<h1>Deletion</h1>',
    }, database);
  }

  /** Full verify pipeline so the draft can be published through the real service. */
  async function verifyDraft(draftId: string, revision: number) {
    // The case row already exists on a re-verify (new revision of the same draft).
    const existing = await pool.query('SELECT 1 FROM problem_draft_testcases WHERE draft_id=$1 AND case_number=1', [draftId]);
    if (!existing.rows.length) {
      await pool.query(`INSERT INTO problem_draft_testcases
        (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
        VALUES ($1,$2,1,'1.in','1\n','2\n','uploaded',$3)`,
        [randomUUID(), draftId, revision]);
    }
    const queued = await queueVerifyJob(draftId, revision, database);
    if (queued.kind !== 'queued') throw new Error(queued.kind);
    const captured = queued.job.request_snapshot!;
    const bytes = Number((await pool.query(`SELECT COALESCE(SUM(octet_length(input_data) + octet_length(output_data)), 0)::text AS total
      FROM problem_draft_testcases WHERE draft_id=$1`, [draftId])).rows[0].total);
    await applyJobResult(queued.job.id, {
      version: 1, jobId: queued.job.id, draftId, revision,
      status: 'succeeded', errorCode: null, log: '', durationMs: 1, exitCode: 0,
      pdf: { sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), templateVersion: 'red-gate-v1' },
      verification: {
        checks: { pdf: 'passed', solution: 'passed', generator: 'skipped', execution: 'passed' },
        cases: captured.cases!.map(c => ({ caseId: c.caseId, caseNumber: c.caseNumber, durationMs: 1 })),
        caseCount: captured.cases!.length, totalTestcaseBytes: bytes, memoryLimitMb: 256,
        peakMemoryBytes: null, warnings: ['Peak RSS unavailable.'],
      },
    }, database, undefined, async () => pdf);
  }

  async function createPublishedDraft(problemId: string, profileId: string | null = null) {
    const draft = await createDraft(problemId, profileId);
    await verifyDraft(draft.id, 1);
    const result = await publishProblemDraft(draft.id, 1, database);
    if (result.kind !== 'created') throw new Error(result.kind);
    return draft;
  }

  const deleteDraft = (id: string, role = 'admin') =>
    request(app).delete(`/admin/authoring/drafts/${id}`).set('x-test-role', role);

  describe('DELETE /admin/authoring/drafts/:id', () => {
    it('rejects anonymous and plain users, accepts staff', async () => {
      const draft = await createDraft('auth-check');
      const badId = randomUUID();
      expect((await request(app).delete(`/admin/authoring/drafts/${badId}`)).status).toBe(401);
      expect((await deleteDraft(badId, 'user')).status).toBe(403);
      expect((await deleteDraft(draft.id, 'staff')).status).toBe(200);
    });

    it('rejects invalid ids with 400', async () => {
      expect((await deleteDraft('not-a-uuid', 'admin')).status).toBe(400);
    });

    it('deletes a draft and every draft-owned row, leaving other drafts intact', async () => {
      const target = await createDraft('delete-target');
      const other = await createDraft('delete-survivor');
      // Draft-owned artifacts for both drafts.
      for (const draftId of [target.id, other.id]) {
        await pool.query(`INSERT INTO problem_draft_testcases
          (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
          VALUES ($1,$2,1,'1.in','1\n','2\n','uploaded',1)`, [randomUUID(), draftId]);
        await pool.query(`INSERT INTO problem_draft_assets (id,draft_id,filename,mime_type,content,checksum_sha256,size_bytes)
          VALUES ($1,$2,'diagram.png','image/png',$3,$4,1)`,
          [randomUUID(), draftId, Buffer.from([0x89]), createHash('sha256').update('x').digest('hex')]);
        const jobId = randomUUID();
        await pool.query(`INSERT INTO authoring_jobs (id,draft_id,job_type,draft_revision)
          VALUES ($1,$2,'compile_solution',1)`, [jobId, draftId]);
        const caseId = randomUUID();
        await pool.query(`INSERT INTO authoring_job_inputs (job_id,case_id,case_number,input_data)
          VALUES ($1,$2,1,'1\n')`, [jobId, caseId]);
        await pool.query(`INSERT INTO authoring_job_files (job_id,name,content)
          VALUES ($1,'artifact',$2)`, [jobId, Buffer.from('x')]);
        const syncId = randomUUID();
        await pool.query(`INSERT INTO authoring_profile_syncs (id,profile_id) VALUES ($1,$2)`, [syncId, await createProfile()]);
        await pool.query(`INSERT INTO authoring_profile_sync_items (id,sync_id,draft_id) VALUES ($1,$2,$3)`,
          [randomUUID(), syncId, draftId]);
      }

      const response = await deleteDraft(target.id);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Authoring draft deleted', problemId: 'delete-target', wasPublished: false });

      // Target draft-owned rows: all gone.
      expect(await count('problem_drafts', 'WHERE id=$1', [target.id])).toBe(0);
      expect(await count('problem_draft_testcases', 'WHERE draft_id=$1', [target.id])).toBe(0);
      expect(await count('problem_draft_assets', 'WHERE draft_id=$1', [target.id])).toBe(0);
      expect(await count('authoring_jobs', 'WHERE draft_id=$1', [target.id])).toBe(0);
      expect(await count('authoring_job_inputs', 'WHERE job_id IN (SELECT id FROM authoring_jobs WHERE draft_id=$1)', [target.id])).toBe(0);
      expect(await count('authoring_job_files', 'WHERE job_id IN (SELECT id FROM authoring_jobs WHERE draft_id=$1)', [target.id])).toBe(0);
      expect(await count('authoring_profile_sync_items', 'WHERE draft_id=$1', [target.id])).toBe(0);
      expect(await count('authoring_published_problems', 'WHERE draft_id=$1', [target.id])).toBe(0);

      // The surviving draft keeps all of its rows.
      expect(await count('problem_drafts', 'WHERE id=$1', [other.id])).toBe(1);
      expect(await count('problem_draft_testcases', 'WHERE draft_id=$1', [other.id])).toBe(1);
      expect(await count('problem_draft_assets', 'WHERE draft_id=$1', [other.id])).toBe(1);
      expect(await count('authoring_jobs', 'WHERE draft_id=$1', [other.id])).toBe(1);
      expect(await count('authoring_job_inputs', 'WHERE job_id IN (SELECT id FROM authoring_jobs WHERE draft_id=$1)', [other.id])).toBe(1);
      expect(await count('authoring_job_files', 'WHERE job_id IN (SELECT id FROM authoring_jobs WHERE draft_id=$1)', [other.id])).toBe(1);
      expect(await count('authoring_profile_sync_items', 'WHERE draft_id=$1', [other.id])).toBe(1);
    });

    it('is idempotent for missing drafts (404)', async () => {
      expect((await deleteDraft(randomUUID())).status).toBe(404);
    });

    it('deletes a published draft but never the published problem or its testcases', async () => {
      const draft = await createPublishedDraft('published-keep');
      // The problem exists with its testcases and provenance.
      expect(await count('problems', "WHERE id='published-keep'")).toBe(1);
      expect(await count('testcases', "WHERE problem_id='published-keep'")).toBe(1);
      expect(await count('authoring_published_problems', 'WHERE draft_id=$1', [draft.id])).toBe(1);

      const response = await deleteDraft(draft.id);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Authoring draft deleted', problemId: 'published-keep', wasPublished: true });

      // The published problem is fully intact — never deleted.
      expect(await count('problems', "WHERE id='published-keep'")).toBe(1);
      expect(await count('testcases', "WHERE problem_id='published-keep'")).toBe(1);
      const problem = (await pool.query("SELECT title, author, problem_pdf FROM problems WHERE id='published-keep'")).rows[0];
      expect(problem.title).toBe('Deletion test published-keep');
      expect(problem.author).toBe('AKA Author'); // historical attribution survives
      expect(problem.problem_pdf.equals(pdf)).toBe(true);

      // The draft and its provenance row are gone (provenance is draft-owned).
      expect(await count('problem_drafts', 'WHERE id=$1', [draft.id])).toBe(0);
      expect(await count('authoring_published_problems', 'WHERE draft_id=$1', [draft.id])).toBe(0);
      expect(await count('testcases', 'WHERE problem_id=$1', ['published-keep'])).toBe(1);
    });

    it('keeps the publish pipeline working for other drafts after a published draft is deleted', async () => {
      const doomed = await createPublishedDraft('doomed-problem');
      expect((await deleteDraft(doomed.id)).status).toBe(200);

      // A different draft publishes normally afterwards.
      const survivor = await createDraft('survivor-problem');
      await verifyDraft(survivor.id, 1);
      const published = await publishProblemDraft(survivor.id, 1, database);
      expect(published.kind).toBe('created');
      expect(await count('problems', "WHERE id='survivor-problem'")).toBe(1);
    });

    it('a new draft for a deleted published problem id reports a conflict, never overwrites', async () => {
      const original = await createPublishedDraft('conflict-problem');
      expect((await deleteDraft(original.id)).status).toBe(200);

      const replacement = await createDraft('conflict-problem');
      await verifyDraft(replacement.id, 1);
      const published = await publishProblemDraft(replacement.id, 1, database);
      // The legacy problem is untouched by the deletion, so the insert conflicts.
      expect(published.kind).toBe('problem_id_conflict');
      const problem = (await pool.query("SELECT title FROM problems WHERE id='conflict-problem'")).rows[0];
      expect(problem.title).toBe('Deletion test conflict-problem');
    });
  });

  describe('DELETE /admin/author-profiles/:id', () => {
    it('rejects anonymous and plain users', async () => {
      const profileId = await createProfile();
      expect((await request(app).delete(`/admin/author-profiles/${profileId}`)).status).toBe(401);
      expect((await request(app).delete(`/admin/author-profiles/${profileId}`).set('x-test-role', 'user')).status).toBe(403);
      expect((await request(app).delete(`/admin/author-profiles/not-a-uuid`).set('x-test-role', 'admin')).status).toBe(400);
      expect((await request(app).delete(`/admin/author-profiles/${randomUUID()}`).set('x-test-role', 'admin')).status).toBe(404);
    });

    it('blocks deletion while active (unpublished) drafts reference the profile', async () => {
      const profileId = await createProfile();
      await createDraft('blocked-one', profileId);
      await createDraft('blocked-two', profileId);
      await createPublishedDraft('blocked-published', profileId);

      const response = await request(app).delete(`/admin/author-profiles/${profileId}`).set('x-test-role', 'admin');
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: 'This profile is currently referenced by 2 drafts. Reassign or delete those drafts first.',
        code: 'author_profile_has_active_drafts',
        activeDrafts: 2,
      });
      // Nothing was deleted.
      expect(await count('author_profiles', 'WHERE id=$1', [profileId])).toBe(1);
      expect(await count('problem_drafts', 'WHERE author_profile_id=$1', [profileId])).toBe(3);
    });

    it('deletes a profile with no drafts and its sync history', async () => {
      const profileId = await createProfile();
      // A sync run with an item for an unrelated draft (the draft belongs to
      // another profile, so it does not block this profile's deletion).
      const unrelated = await createDraft('sync-bystander', await createProfile('Other'));
      const syncId = randomUUID();
      await pool.query(`INSERT INTO authoring_profile_syncs (id,profile_id) VALUES ($1,$2)`, [syncId, profileId]);
      await pool.query(`INSERT INTO authoring_profile_sync_items (id,sync_id,draft_id) VALUES ($1,$2,$3)`,
        [randomUUID(), syncId, unrelated.id]);

      const response = await request(app).delete(`/admin/author-profiles/${profileId}`).set('x-test-role', 'admin');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Author profile deleted', detachedDrafts: 0 });
      expect(await count('author_profiles', 'WHERE id=$1', [profileId])).toBe(0);
      expect(await count('authoring_profile_syncs', 'WHERE profile_id=$1', [profileId])).toBe(0);
      // The orphaned sync item is removed with its sync run.
      expect(await count('authoring_profile_sync_items', 'WHERE sync_id=$1', [syncId])).toBe(0);
    });

    it('deletes a profile referenced only by published drafts, detaching them without losing attribution', async () => {
      const profileId = await createProfile('Historic Author');
      const draft = await createPublishedDraft('history-problem', profileId);
      const syncId = randomUUID();
      await pool.query(`INSERT INTO authoring_profile_syncs (id,profile_id) VALUES ($1,$2)`, [syncId, profileId]);
      await pool.query(`INSERT INTO authoring_profile_sync_items (id,sync_id,draft_id) VALUES ($1,$2,$3)`,
        [randomUUID(), syncId, draft.id]);

      const response = await request(app).delete(`/admin/author-profiles/${profileId}`).set('x-test-role', 'admin');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Author profile deleted', detachedDrafts: 1 });

      expect(await count('author_profiles', 'WHERE id=$1', [profileId])).toBe(0);
      // The published draft survives, detached from the profile, with its
      // frozen author snapshot intact.
      const surviving = (await pool.query('SELECT author_aka_name, author_real_name, language, country_code FROM problem_drafts WHERE id=$1', [draft.id])).rows[0];
      expect(surviving).toEqual({ author_aka_name: 'AKA Author', author_real_name: 'Real Author', language: 'Thai', country_code: 'THA' });
      // The published problem keeps its historical attribution.
      const problem = (await pool.query("SELECT author FROM problems WHERE id='history-problem'")).rows[0];
      expect(problem.author).toBe('AKA Author');
      // Profile-owned sync history is gone.
      expect(await count('authoring_profile_syncs', 'WHERE profile_id=$1', [profileId])).toBe(0);
      expect(await count('authoring_profile_sync_items', 'WHERE draft_id=$1', [draft.id])).toBe(0);
    });

    it('a detached published draft can start a new revision and republish', async () => {
      const profileId = await createProfile('Republish Author');
      const draft = await createPublishedDraft('republish-problem', profileId);
      expect((await request(app).delete(`/admin/author-profiles/${profileId}`).set('x-test-role', 'admin')).status).toBe(200);

      const reopened = await updateProblemDraft(draft.id, 1, { statement_html: '<h1>Revised</h1>' }, database);
      if (reopened.kind !== 'updated') throw new Error(reopened.kind);
      await verifyDraft(draft.id, reopened.draft.revision);
      const republished = await publishProblemDraft(draft.id, reopened.draft.revision, database);
      expect(republished.kind).toBe('updated');
      const problem = (await pool.query("SELECT title FROM problems WHERE id='republish-problem'")).rows[0];
      expect(problem.title).toBe('Deletion test republish-problem');
    });
  });
});
