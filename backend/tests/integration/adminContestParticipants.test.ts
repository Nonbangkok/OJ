import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import contestRoutes from '../../controllers/contestController';
import { errorHandler } from '../../middleware/errorHandler';
import { attachRequestUser } from '../../middleware/requestContext';
import { runMigrationsFromPool } from '../../scripts/migrate';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('GET /admin/contests/:id/participants', () => {
  const schema = `acp_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  let role = 'staff';
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'acp-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.username = 'staffer'; req.session.role = role; next(); });
  app.use(attachRequestUser);
  app.use(contestRoutes); app.use(errorHandler);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    role = 'staff';
    await pool.query('TRUNCATE users, problems, contests CASCADE');
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'staffer', 'x', 'staff'), (2, 'mint', 'x', 'user'), (3, 'arm', 'x', 'user')");
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible) VALUES
      (1, 'C', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'scheduled', false), (2, 'Empty', NOW(), NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES
      (1, 3, '2026-11-20T03:00:00Z'), (1, 2, '2026-11-20T02:00:00Z')`);
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('lists who joined and when, earliest first — even for a hidden contest', async () => {
    const res = await request(app).get('/admin/contests/1/participants').expect(200);
    expect(res.body).toEqual([
      { user_id: 2, username: 'mint', joined_at: '2026-11-20T02:00:00.000Z' },
      { user_id: 3, username: 'arm', joined_at: '2026-11-20T03:00:00.000Z' },
    ]);
  });

  it('an existing contest with nobody joined is an empty list; a missing one is 404', async () => {
    await request(app).get('/admin/contests/2/participants').expect(200, []);
    await request(app).get('/admin/contests/99/participants').expect(404);
  });

  it('students cannot read it', async () => {
    role = 'user';
    await request(app).get('/admin/contests/1/participants').expect(403);
  });
});
