import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import problemRoutes from '../../controllers/problemController';
import draftRoutes from '../../controllers/authoringDraftController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getProblemsWithStatsForUser } from '../../services/problemQueryService';
import { createProblemDraft, updateProblemDraft } from '../../services/authoringDraftQueryService';
import { applyJobResult, queueVerifyJob } from '../../services/authoringJobQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('problem difficulty end-to-end', () => {
  const schema = `diff13_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const database = { pool, query: pool.query.bind(pool) };
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'difficulty-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.role = role; } next(); });
  app.use(problemRoutes); app.use(draftRoutes); app.use(errorHandler);
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts,problems CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const pdf = Buffer.from('%PDF-1.4\n%%EOF');
  const source = '#include <iostream>\nint main(){int n;if(std::cin>>n)std::cout<<n*2<<"\\n";}';

  const insertProblem = (id: string, difficulty: number | null, title = id) =>
    pool.query(`INSERT INTO problems (id,title,author,categories,difficulty,time_limit_ms,memory_limit_mb,is_visible)
      VALUES ($1,$2,'A','{}',$3,1000,256,true)`, [id, title, difficulty]);

  describe('problem list filter & sort', () => {
    beforeEach(async () => {
      await insertProblem('easy', 800);
      await insertProblem('mid', 1500);
      await insertProblem('hard', 2500);
      await insertProblem('insane', 3300);
      await insertProblem('unrated', null);
    });

    it('includes Unrated problems when no difficulty filter is selected', async () => {
      const page = await getProblemsWithStatsForUser(1);
      expect(page.problems.map(p => p.id)).toEqual(['easy', 'hard', 'insane', 'mid', 'unrated']);
      expect(page.problems.map(p => p.difficulty)).toEqual([800, 2500, 3300, 1500, null]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('filters by difficultyMin and difficultyMax (inclusive), excluding Unrated', async () => {
      const minOnly = await getProblemsWithStatsForUser(1, { difficultyMin: 1500 });
      expect(minOnly.problems.map(p => p.id)).toEqual(['hard', 'insane', 'mid']);
      const maxOnly = await getProblemsWithStatsForUser(1, { difficultyMax: 1500 });
      expect(maxOnly.problems.map(p => p.id)).toEqual(['easy', 'mid']);
      const both = await getProblemsWithStatsForUser(1, { difficultyMin: 900, difficultyMax: 2600 });
      expect(both.problems.map(p => p.id)).toEqual(['hard', 'mid']);
    });

    it('sorts by difficulty with NULLS LAST in both directions', async () => {
      const asc = await getProblemsWithStatsForUser(1, { sort: 'difficulty', order: 'asc' });
      expect(asc.problems.map(p => p.id)).toEqual(['easy', 'mid', 'hard', 'insane', 'unrated']);
      const desc = await getProblemsWithStatsForUser(1, { sort: 'difficulty', order: 'desc' });
      expect(desc.problems.map(p => p.id)).toEqual(['insane', 'hard', 'mid', 'easy', 'unrated']);
    });

    it('returns 400 for out-of-scale difficulty query params', async () => {
      const res = await request(app).get('/problems-with-stats?difficultyMin=700').set('x-test-role', 'user');
      expect(res.status).toBe(400);
      const res2 = await request(app).get('/problems-with-stats?difficultyMax=3600').set('x-test-role', 'user');
      expect(res2.status).toBe(400);
      const res3 = await request(app).get('/problems-with-stats?difficultyMin=1250').set('x-test-role', 'user');
      expect(res3.status).toBe(400);
    });

    it('rejects a difficulty that violates the CHECK constraint', async () => {
      await expect(insertProblem('bad', 1250)).rejects.toThrow();
      await expect(insertProblem('bad', 3600)).rejects.toThrow();
    });
  });

  describe('admin problem CRUD', () => {
    it('creates and updates problems with difficulty', async () => {
      const created = await request(app).post('/admin/problems').set('x-test-role', 'admin')
        .send({ id: 'crud-1', title: 'CRUD', author: 'A', categories: [], time_limit_ms: 1000, memory_limit_mb: 256, difficulty: 1200 });
      expect(created.status).toBe(201);
      expect(created.body.difficulty).toBe(1200);

      const updated = await request(app).put('/admin/problems/crud-1').set('x-test-role', 'admin')
        .send({ id: 'crud-1', difficulty: 2600 });
      expect(updated.status).toBe(200);
      expect(updated.body.difficulty).toBe(2600);

      // null explicitly clears the rating (Unrated)
      const cleared = await request(app).put('/admin/problems/crud-1').set('x-test-role', 'admin')
        .send({ id: 'crud-1', difficulty: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.difficulty).toBeNull();

      // omitted field leaves it unchanged
      const untouched = await request(app).put('/admin/problems/crud-1').set('x-test-role', 'admin')
        .send({ id: 'crud-1', title: 'Renamed' });
      expect(untouched.status).toBe(200);
      expect(untouched.body.difficulty).toBeNull();

      // invalid values are rejected with 400
      for (const difficulty of [700, 3600, 1250, 1200.5, '1200']) {
        const res = await request(app).post('/admin/problems').set('x-test-role', 'admin')
          .send({ id: `bad-${difficulty}`, title: 'Bad', author: 'A', time_limit_ms: 1000, memory_limit_mb: 256, difficulty });
        expect(res.status).toBe(400);
      }
    });

    it('exposes difficulty on problem details and the admin list', async () => {
      await insertProblem('detail-1', 1900);
      const detail = await request(app).get('/problems/detail-1');
      expect(detail.status).toBe(200);
      expect(detail.body.difficulty).toBe(1900);
      const adminList = await request(app).get('/admin/problems').set('x-test-role', 'admin');
      expect(adminList.body.find((p: { id: string }) => p.id === 'detail-1').difficulty).toBe(1900);
    });
  });

  describe('authoring publish flow', () => {
    async function draft(problemId = 'difficulty-publish', difficulty: number | null = 1400) {
      const d = await createProblemDraft({ problem_id: problemId, title: 'Difficulty publish', author_profile_id: null,
        author_aka_name: 'AKA', author_real_name: 'Real', language: 'Thai', country_code: 'THA',
        categories: [], difficulty,
        time_limit_ms: 1000, memory_limit_mb: 256, created_by: null, solution_cpp: source,
        generator_cpp: null, statement_html: '<h1>Difficulty</h1>' }, database);
      await pool.query(`INSERT INTO problem_draft_testcases
        (id,draft_id,case_number,original_input_filename,input_data,output_data,source,source_revision)
        VALUES ($1,$2,1,'1.in','1','2','uploaded',1)`, [randomUUID(), d.id]);
      return d;
    }
    async function verify(d: Awaited<ReturnType<typeof draft>>, revision: number) {
      const queued = await queueVerifyJob(d.id, revision, database);
      if (queued.kind !== 'queued') throw new Error(queued.kind);
      const captured = queued.job.request_snapshot!;
      await applyJobResult(queued.job.id, { version: 1, jobId: queued.job.id, draftId: d.id, revision,
        status: 'succeeded', errorCode: null, log: '', durationMs: 1, exitCode: 0,
        pdf: { sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), templateVersion: 'red-gate-v1' },
        verification: { checks: { pdf: 'passed', solution: 'passed', generator: 'skipped', execution: 'passed' },
          cases: captured.cases!.map(c => ({ caseId: c.caseId, caseNumber: c.caseNumber, durationMs: 1 })),
          caseCount: captured.cases!.length, totalTestcaseBytes: 2, memoryLimitMb: 256, peakMemoryBytes: null, warnings: ['Peak RSS unavailable.'] } },
      database, undefined, async () => pdf);
    }

    it('propagates draft difficulty to the published problem and provenance row', async () => {
      const d = await draft(); await verify(d, 1);
      const response = await request(app).post(`/admin/authoring/drafts/${d.id}/publish`)
        .set('x-test-role', 'admin').send({ expectedRevision: 1 });
      expect(response.status).toBe(201);

      const problem = (await pool.query('SELECT difficulty FROM problems WHERE id=$1', [d.problem_id])).rows[0];
      expect(problem.difficulty).toBe(1400);
      const provenance = (await pool.query('SELECT difficulty FROM authoring_published_problems WHERE draft_id=$1', [d.id])).rows[0];
      expect(provenance.difficulty).toBe(1400);
    });

    it('propagates a null (Unrated) draft difficulty', async () => {
      const d = await draft('difficulty-null', null); await verify(d, 1);
      const response = await request(app).post(`/admin/authoring/drafts/${d.id}/publish`)
        .set('x-test-role', 'admin').send({ expectedRevision: 1 });
      expect(response.status).toBe(201);
      const problem = (await pool.query('SELECT difficulty FROM problems WHERE id=$1', [d.problem_id])).rows[0];
      expect(problem.difficulty).toBeNull();
    });

    it('round-trips difficulty through draft update and the detail response', async () => {
      const d = await draft('difficulty-roundtrip', 900);
      expect((d as { difficulty: number | null }).difficulty).toBe(900);
      const updated = await updateProblemDraft(d.id, 1, { difficulty: 2300 }, database);
      expect(updated.kind).toBe('updated');
      if (updated.kind !== 'updated') throw new Error(updated.kind);
      expect(updated.draft.difficulty).toBe(2300);
      const cleared = await updateProblemDraft(d.id, 2, { difficulty: null }, database);
      expect(cleared.kind).toBe('updated');
      if (cleared.kind !== 'updated') throw new Error(cleared.kind);
      expect(cleared.draft.difficulty).toBeNull();

      const detail = await request(app).get(`/admin/authoring/drafts/${d.id}`).set('x-test-role', 'admin');
      expect(detail.body.difficulty).toBeNull();
    });
  });
});

// Keep the supertest/express imports meaningful even when the suite is skipped.
void request; void express; void session; void db;
