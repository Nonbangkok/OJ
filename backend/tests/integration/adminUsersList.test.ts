import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import bcrypt from 'bcrypt';
import * as db from '../../db';
import adminRoutes from '../../controllers/adminController';
import authRoutes from '../../controllers/authController';
import { errorHandler } from '../../middleware/errorHandler';
import { attachRequestUser } from '../../middleware/requestContext';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getAdminUsers } from '../../services/adminQueryService';

jest.unmock('pg');
jest.mock('../../db', () => {
  const actual = jest.requireActual('../../db');
  return { query: jest.fn(), pool: { connect: jest.fn() }, withTransaction: jest.fn(), createMigrationsPool: actual.createMigrationsPool };
});
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('admin users list facts and bulk role (B5)', () => {
  const schema = `aul_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'aul-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.username = 'boss'; req.session.role = role; } next(); });
  app.use(attachRequestUser);
  app.use(adminRoutes); app.use(authRoutes); app.use(errorHandler);
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 16, 6, 0) + minutes * 60_000);
  const byName = async () => Object.fromEntries((await getAdminUsers(1, 50)).users.map((u) => [u.username, u]));

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, problems, contests CASCADE');
    await pool.query(`INSERT INTO users (id, username, password_hash, role, submissions_locked, last_login_at) VALUES
      (1, 'boss', 'x', 'admin', false, $1), (2, 'ann', 'x', 'user', false, $2), (3, 'ben', 'x', 'user', true, NULL),
      (4, 'Nonbangkok', 'x', 'admin', false, NULL), (5, 'cat', 'x', 'staff', false, NULL)`, [at(0), at(10)]);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('p1', 'P1', 'a', '{}', 1000, 256, true), ('p2', 'P2', 'a', '{}', 1000, 256, true)`);
    await pool.query(`INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results, submitted_at) VALUES
      (2, 'p1', 'x', 'cpp', 'Accepted', 100, '[]', $1), (2, 'p2', 'x', 'cpp', 'Wrong Answer', 0, '[]', $2), (3, 'p1', 'x', 'cpp', 'Accepted', 100, '[]', $3)`,
      [at(5), at(30), at(40)]);
    await pool.query(`INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, difficulty_snapshot, awarded_at)
      VALUES (2, 'p1', 40, 1200, $1), (3, 'p1', 40, 1200, $2)`, [at(5), at(40)]);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    (db.withTransaction as jest.Mock).mockImplementation(async (fn: (c: pg.PoolClient) => unknown) => {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r; }
      catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    });
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('list rows carry last_active_at from the latest login or submission', async () => {
    const users = await byName();
    expect(new Date(users.ann.last_active_at as string).getTime()).toBe(at(30).getTime());
    expect(new Date(users.ben.last_active_at as string).getTime()).toBe(at(40).getTime());
    expect(new Date(users.boss.last_active_at as string).getTime()).toBe(at(0).getTime());
    expect(users.cat.last_active_at).toBeNull();
  });

  it('solved_count, xp and submission_count per user', async () => {
    const users = await byName();
    expect(users.ann).toMatchObject({ solved_count: 1, xp: 40, submission_count: 2 });
    expect(users.cat).toMatchObject({ solved_count: 0, xp: 0, submission_count: 0 });
  });

  it('locked filter narrows to submissions_locked users', async () => {
    const locked = await getAdminUsers(1, 50, { locked: 'locked' });
    expect(locked.users.map((u) => u.username)).toEqual(['ben']);
    expect(locked.total).toBe(1);
    const unlocked = await getAdminUsers(1, 50, { locked: 'unlocked' });
    expect(unlocked.users.map((u) => u.username)).not.toContain('ben');
  });

  it('bulk role updates the listed users and skips the protected admin and the actor', async () => {
    const res = await request(app).put('/admin/users/role').set('x-test-role', 'admin')
      .send({ ids: [2, 3, 4, 1, 99], role: 'staff' }).expect(200);
    expect(res.body.updated.sort()).toEqual([2, 3]);
    expect(res.body.skipped).toEqual(expect.arrayContaining([
      { id: 4, reason: 'protected' }, { id: 1, reason: 'self' }, { id: 99, reason: 'not_found' },
    ]));
    const users = await byName();
    expect([users.ann.role, users.ben.role, users.Nonbangkok.role, users.boss.role]).toEqual(['staff', 'staff', 'admin', 'admin']);
  });

  it('bulk role is admin-only (403 for staff)', async () => {
    await request(app).put('/admin/users/role').set('x-test-role', 'staff').send({ ids: [2], role: 'staff' }).expect(403);
  });

  it('login stamps last_login_at', async () => {
    const hash = await bcrypt.hash('secret-pass-1', 4);
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (6, 'dan', $1, 'user')", [hash]);
    await request(app).post('/login').send({ username: 'dan', password: 'secret-pass-1' }).expect(200);
    const row = await pool.query('SELECT last_login_at FROM users WHERE id = 6');
    expect(row.rows[0].last_login_at).not.toBeNull();
  });
});
