import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import problemRoutes from '../../controllers/problemController';
import { errorHandler } from '../../middleware/errorHandler';
import { attachRequestUser } from '../../middleware/requestContext';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getSubmissionDetail, getSubmissions } from '../../services/submissionQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('submission and problem detail fields for the student pages', () => {
  const schema = `subf_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'subf-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.role = role; } next(); });
  app.use(attachRequestUser);
  app.use(problemRoutes); app.use(errorHandler);
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE submissions, problems, collections, users CASCADE');
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'user'), (2, 'u2', 'x', 'user')");
    await pool.query("INSERT INTO collections (id, name) VALUES (7, 'Basics')");
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, collection_id)
      VALUES ('vis', 'Visible', 'A', '{}', 1500, 128, true, 7), ('hid', 'Hidden', 'A', '{}', 1000, 256, false, NULL)`);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const submit = (userId: number, problemId: string, status: string, score: number, results: string, maxTime: number | null = null, maxMem: number | null = null) =>
    pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results, max_time_ms, max_memory_kb)
       VALUES ($1, $2, 'x', 'cpp', $3, $4, $5::jsonb, $6, $7) RETURNING id`,
      [userId, problemId, status, score, results, maxTime, maxMem],
    ).then(r => r.rows[0].id as number);

  it('list rows carry case statuses and max time/memory', async () => {
    await submit(1, 'vis', 'Wrong Answer', 50, '[{"status":"Accepted"},{"status":"Wrong Answer"},{"status":"Skipped"}]', 410, 12300);
    const [row] = await getSubmissions({ filter: 'mine' }, 1, false);
    expect(row).toMatchObject({ case_statuses: ['Accepted', 'Wrong Answer', 'Skipped'], max_time_ms: 410, max_memory_kb: 12300 });
  });

  it('a string results value yields no case statuses', async () => {
    await submit(1, 'vis', 'Compilation Error', 0, '"main.cpp:1: error"');
    const [row] = await getSubmissions({ filter: 'mine' }, 1, false);
    expect(row.case_statuses).toEqual([]);
  });

  it('a compile error as the judge stores it yields its one status (the client draws no strip for it)', async () => {
    await submit(1, 'vis', 'Compilation Error', 0, '[{"status":"Compilation Error","output":"main.cpp:1: error"}]');
    const [row] = await getSubmissions({ filter: 'mine' }, 1, false);
    expect(row.case_statuses).toEqual(['Compilation Error']);
  });

  it('the problem filter also matches the problem title, within visible problems', async () => {
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('two_sum', 'Two Sum Sorted', 'A', '{}', 1000, 256, true)`);
    await submit(1, 'two_sum', 'Accepted', 100, '[]');
    await submit(1, 'vis', 'Accepted', 100, '[]');
    const rows = await getSubmissions({ filterProblemId: 'sum sorted' }, 1, false);
    expect(rows.map(r => r.problem_id)).toEqual(['two_sum']);
  });

  it('verdict filters by overall status', async () => {
    await submit(1, 'vis', 'Accepted', 100, '[]');
    await submit(1, 'vis', 'Wrong Answer', 0, '[]');
    const rows = await getSubmissions({ filter: 'mine', verdict: 'Accepted' }, 1, false);
    expect(rows.map(r => r.overall_status)).toEqual(['Accepted']);
  });

  it('non-staff can filter by problem id within visible problems', async () => {
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('vis2', 'Other', 'A', '{}', 1000, 256, true)`);
    await submit(1, 'vis', 'Accepted', 100, '[]');
    await submit(1, 'vis2', 'Accepted', 100, '[]');
    await submit(1, 'hid', 'Accepted', 100, '[]');
    const rows = await getSubmissions({ filterProblemId: 'vis2' }, 1, false);
    expect(rows.map(r => r.problem_id)).toEqual(['vis2']);
    expect((await getSubmissions({ filterProblemId: 'hid' }, 1, false))).toEqual([]);
  });

  it('detail includes the problem limits', async () => {
    const id = await submit(1, 'vis', 'Accepted', 100, '[]');
    expect(await getSubmissionDetail(String(id))).toMatchObject({ time_limit_ms: 1500, memory_limit_mb: 128 });
  });

  it('problem detail carries collection, viewer best and submission count', async () => {
    await submit(1, 'vis', 'Wrong Answer', 40, '[{"status":"Accepted"},{"status":"Wrong Answer"}]');
    await submit(1, 'vis', 'Wrong Answer', 20, '[{"status":"Wrong Answer"}]');
    await submit(2, 'vis', 'Accepted', 100, '[{"status":"Accepted"}]');
    const res = await request(app).get('/problems/vis').set('x-test-role', 'user');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      collection: { id: 7, name: 'Basics' },
      viewerBest: { score: 40, caseStatuses: ['Accepted', 'Wrong Answer'] },
      viewerSubmissionCount: 2,
    });
  });

  it('problem detail viewer fields are null and 0 for guests', async () => {
    await submit(1, 'vis', 'Accepted', 100, '[]');
    const res = await request(app).get('/problems/vis');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ collection: { id: 7, name: 'Basics' }, viewerBest: null, viewerSubmissionCount: 0 });
  });
});

void request; void express; void session;
