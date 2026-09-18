import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import router from '../../controllers/authoringWorkspaceController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { createProblemDraft } from '../../services/authoringDraftQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('workspace reads against durable PostgreSQL data', () => {
  const schema = `slice10_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const database = { pool, query: pool.query.bind(pool) };
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'workspace-integration', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.role = 'admin'; next(); });
  app.use(router); app.use(errorHandler);
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE problem_drafts CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  async function draft() {
    return createProblemDraft({ problem_id: 'workspace', title: 'Workspace', author_profile_id: null,
      author_aka_name: 'A', author_real_name: 'Author', language: 'English', country_code: 'GBR',
      time_limit_ms: 1000, memory_limit_mb: 256, created_by: null,
      solution_cpp: 'PRIVATE SOLUTION', generator_cpp: 'PRIVATE GENERATOR', statement_html: '<p>SAVED</p>' }, database);
  }

  it('returns only the newest100 jobs for one draft, including deterministic timestamp ties and no private data', async () => {
    const d = await draft(); const other = await draft();
    for (let i = 0; i < 105; i++) {
      await pool.query(`INSERT INTO authoring_jobs (id,draft_id,draft_revision,job_type,status,created_at,log,request_snapshot)
        VALUES ($1,$2,1,'compile_solution','succeeded',$3,'PRIVATE LOG',$4::jsonb)`,
      [`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, d.id,
        new Date(Date.UTC(2026, 8, 15, 0, 0, Math.floor(i / 2))), JSON.stringify({ source: 'PRIVATE SOURCE' })]);
    }
    await pool.query(`INSERT INTO authoring_jobs (id,draft_id,draft_revision,job_type,status,created_at)
      VALUES ($1,$2,1,'compile_solution','succeeded','2030-01-01')`, [randomUUID(), other.id]);
    const response = await request(app).get(`/admin/authoring/drafts/${d.id}/jobs`);
    expect(response.status).toBe(200); expect(response.body).toHaveLength(100);
    expect(response.body.map((job: { id: string }) => job.id)).toEqual(
      Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(104 - i).padStart(12, '0')}`));
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
    expect((await request(app).get(`/admin/authoring/drafts/${randomUUID()}/jobs`)).status).toBe(404);
  });

  it('previews unsaved HTML without modifying revision, statement, readiness or job history', async () => {
    const d = await draft();
    const before = (await pool.query('SELECT * FROM problem_drafts WHERE id=$1', [d.id])).rows[0];
    const response = await request(app).post(`/admin/authoring/drafts/${d.id}/preview`).send({ statementHtml: '<h1>UNSAVED $x^2$</h1>' });
    expect(response.status).toBe(200); expect(response.body.html).toContain('<h1>UNSAVED <span class="katex">');
    expect(response.body.html).not.toContain('PRIVATE');
    expect((await pool.query('SELECT * FROM problem_drafts WHERE id=$1', [d.id])).rows[0]).toEqual(before);
    expect((await pool.query('SELECT id FROM authoring_jobs')).rows).toEqual([]);
  });
});
