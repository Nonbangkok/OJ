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
import { getAdminProblemsPage } from '../../services/problemQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('admin problem facts (B6)', () => {
  const schema = `apf_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'apf-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.username = 'staffer'; req.session.role = 'staff'; next(); });
  app.use(attachRequestUser);
  app.use(problemRoutes); app.use(errorHandler);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, problems, contests CASCADE');
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'staffer', 'x', 'staff'), (2, 'u2', 'x', 'user')");
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible) VALUES (1, 'C', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, problem_type, submission_filename, contest_id)
      VALUES ('a', 'A', 'x', '{}', 1500, 128, true, 'standard', NULL, NULL), ('b', 'B', 'x', '{}', 1000, 256, true, 'header', 'student.h', NULL),
             ('c', 'C', 'x', '{}', 1000, 256, false, 'standard', NULL, 1), ('d', 'D', 'x', '{}', 1000, 256, true, 'standard', NULL, NULL)`);
    await pool.query(`INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES
      ('a', 1, '1 2', '3'), ('a', 2, '10 20', '30'), ('c', 1, 'x', 'y')`);
    await pool.query(`INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results)
      VALUES (2, 'a', 'x', 'cpp', 'Accepted', 100, '[]'), (2, 'a', 'x', 'cpp', 'Wrong Answer', 0, '[]')`);
    await pool.query(`INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results)
      VALUES (1, 2, 'c', 'x', 'cpp', 'Accepted', 100, '[]')`);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const rows = async () => Object.fromEntries((await getAdminProblemsPage({})).problems.map((p) => [p.id, p]));

  it('list rows carry type, limits, testcase and submission counts', async () => {
    const list = await rows();
    expect(list.a).toMatchObject({ problem_type: 'standard', time_limit_ms: 1500, memory_limit_mb: 128, testcase_count: 2, submission_count: 2 });
    expect(list.b).toMatchObject({ problem_type: 'header', testcase_count: 0, submission_count: 0 });
  });

  it('type_locked follows any submission, practice or contest', async () => {
    const list = await rows();
    expect([list.a.type_locked, list.b.type_locked, list.c.type_locked, list.d.type_locked]).toEqual([true, false, true, false]);
  });

  it('AC rate and solvers count the same practice + contest submissions as submission_count', async () => {
    await pool.query(`INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results)
      VALUES (1, 2, 'c', 'x', 'cpp', 'Wrong Answer', 0, '[]'), (1, 1, 'c', 'x', 'cpp', 'Accepted', 100, '[]'),
             (1, 2, 'c', 'x', 'cpp', 'Accepted', 100, '[]')`);
    // A user who solved it both in practice and in the contest is one solver.
    await pool.query(`INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results)
      VALUES (2, 'c', 'x', 'cpp', 'Accepted', 100, '[]')`);
    const list = await rows();
    expect(list.c).toMatchObject({ submission_count: 5, accepted_count: 4, solver_count: 2 });
    expect(list.a).toMatchObject({ submission_count: 2, accepted_count: 1, solver_count: 1 });
    expect(list.d).toMatchObject({ submission_count: 0, accepted_count: 0, solver_count: 0 });
    const res = await request(app).get('/admin/problems').expect(200);
    expect(res.body.problems.find((p: { id: string }) => p.id === 'c')).toMatchObject({ accepted_count: 4, solver_count: 2 });
  });

  it('admin detail carries the collection id the editor needs', async () => {
    await pool.query("INSERT INTO collections (id, name) VALUES (7, 'Sorting')");
    await pool.query("UPDATE problems SET collection_id = 7 WHERE id = 'a'");
    const res = await request(app).get('/admin/problems/a').expect(200);
    expect(res.body.collection_id).toBe(7);
    const none = await request(app).get('/admin/problems/b').expect(200);
    expect(none.body.collection_id).toBeNull();
  });

  it('detail carries testcase_count, testcase_bytes, submission_count and type_locked', async () => {
    const res = await request(app).get('/admin/problems/a').expect(200);
    expect(res.body).toMatchObject({ id: 'a', testcase_count: 2, testcase_bytes: 3 + 1 + 5 + 2, submission_count: 2, type_locked: true });
  });
});
