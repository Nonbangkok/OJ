import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import * as db from '../../db';
import authorProfileRoutes from '../../controllers/authorProfileController';
import { errorHandler } from '../../middleware/errorHandler';
import { attachRequestUser } from '../../middleware/requestContext';
import { runMigrationsFromPool } from '../../scripts/migrate';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('author profile facts and account search (B8)', () => {
  const schema = `apf8_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  let role = 'staff';
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'apf8-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = 1; req.session.username = 'staffer'; req.session.role = role; next(); });
  app.use(attachRequestUser);
  app.use(authorProfileRoutes); app.use(errorHandler);

  const ADA = randomUUID();
  const MINT = randomUUID();
  const draft = (profileId: string | null, problemId: string, publishedAt: string | null = null) => pool.query(
    `INSERT INTO problem_drafts (id, problem_id, title, author_profile_id, author_aka_name, author_real_name, language, country_code, time_limit_ms, memory_limit_mb, published_at)
     VALUES ($1, $2, $2, $3, 'x', 'x', 'Thai', 'THA', 1000, 256, $4)`,
    [randomUUID(), problemId, profileId, publishedAt],
  );

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    role = 'staff';
    await pool.query('TRUNCATE users, author_profiles, problem_drafts CASCADE');
    await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES
      (1, 'staffer', 'x', 'staff'), (2, 'mintra', 'x', 'user'), (3, 'mint_k', 'x', 'user'), (4, 'amint', 'x', 'user'), (5, 'm%int', 'x', 'user')`);
    await pool.query(`INSERT INTO author_profiles (id, user_id, aka_name, real_name, default_language, country_code) VALUES
      ($1, NULL, 'Ada', 'Ada Lovelace', 'English', 'GBR'), ($2, 3, 'Mint K', 'Mint Kaew', 'Thai', 'THA')`, [ADA, MINT]);
    await draft(ADA, 'a1');
    await draft(ADA, 'a2', '2026-11-01T00:00:00Z');
    await draft(MINT, 'm1');
    await draft(null, 'orphan');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('draftCount counts every draft using the profile', async () => {
    const res = await request(app).get('/admin/author-profiles').expect(200);
    const byAka = Object.fromEntries(res.body.map((p: { akaName: string }) => [p.akaName, p]));
    expect(byAka.Ada.draftCount).toBe(2);
    expect(byAka['Mint K'].draftCount).toBe(1);
  });

  it('linkedUsername names the linked account', async () => {
    const res = await request(app).get('/admin/author-profiles').expect(200);
    const byAka = Object.fromEntries(res.body.map((p: { akaName: string }) => [p.akaName, p]));
    expect(byAka.Ada.linkedUsername).toBeNull();
    expect(byAka['Mint K'].linkedUsername).toBe('mint_k');
  });

  it('user-candidates matches prefix first and marks accounts already linked', async () => {
    const res = await request(app).get('/admin/author-profiles/user-candidates?q=MINT').expect(200);
    expect(res.body.map((u: { username: string }) => u.username)).toEqual(['mint_k', 'mintra', 'amint']);
    expect(res.body[0]).toEqual({ id: 3, username: 'mint_k', role: 'user', linkedProfile: { id: MINT, akaName: 'Mint K' } });
    expect(res.body[1].linkedProfile).toBeNull();
  });

  it('user-candidates escapes % and _', async () => {
    const res = await request(app).get('/admin/author-profiles/user-candidates?q=m%25').expect(200);
    expect(res.body.map((u: { username: string }) => u.username)).toEqual(['m%int']);
    const underscore = await request(app).get('/admin/author-profiles/user-candidates?q=t_k').expect(200);
    expect(underscore.body.map((u: { username: string }) => u.username)).toEqual(['mint_k']);
  });

  it('user-candidates rejects an empty q (400) and students (403)', async () => {
    await request(app).get('/admin/author-profiles/user-candidates?q=').expect(400);
    role = 'user';
    await request(app).get('/admin/author-profiles/user-candidates?q=mint').expect(403);
  });
});
