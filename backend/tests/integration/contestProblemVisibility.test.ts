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
import { moveProblemsToContest } from '../../services/problemMigration';
import { getUserProfileStats } from '../../services/userProfileQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A6-01 (+ A8-04): a problem attached to a scheduled or running contest
 * is hidden as a standalone problem (`is_visible = false`, `contest_id` set).
 * The collection "Show" toggle and the single-problem visibility endpoint
 * (which the selection bar's "Show" calls once per selected row) must not
 * turn it into a publicly readable standalone problem: guests and
 * non-participants must keep getting 404 from GET /problems/:id, and
 * participants' public profiles must not start counting their contest
 * submissions, until the contest finishes and the problem migrates back.
 */
(databaseUrl ? describe : describe.skip)('contest problems stay hidden through visibility toggles', () => {
  const schema = `cpvis_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'contest-visibility-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    const role = req.header('x-test-role');
    if (role) {
      req.session.userId = Number(req.header('x-test-user-id') ?? 1);
      req.session.username = String(req.header('x-test-username') ?? 'admin1');
      req.session.role = role;
    }
    next();
  });
  app.use(attachRequestUser);
  app.use(problemRoutes); app.use(errorHandler);

  const asAdmin = { 'x-test-role': 'admin', 'x-test-user-id': '1', 'x-test-username': 'admin1' };
  const asOutsider = { 'x-test-role': 'user', 'x-test-user-id': '3', 'x-test-username': 'outsider' };
  let collectionId = 0;

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, collections, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'admin1', 'x', 'admin'), (2, 'participant', 'x', 'user'), (3, 'outsider', 'x', 'user')`);
    collectionId = (await pool.query(`INSERT INTO collections (name) VALUES ('Week 3') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, collection_id)
      VALUES ('cp-contest', 'Secret Contest Title', 'A', '{Graph}', 1000, 256, true, $1),
             ('cp-pool', 'Pool Problem', 'A', '{}', 1000, 256, false, $1)`, [collectionId]);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const contestStates = [
    { label: 'scheduled hidden contest', status: 'scheduled', isVisible: false,
      start: `NOW() + INTERVAL '1 day'`, end: `NOW() + INTERVAL '2 days'` },
    { label: 'running contest', status: 'running', isVisible: true,
      start: `NOW() - INTERVAL '1 hour'`, end: `NOW() + INTERVAL '1 hour'` },
  ];

  const seedContest = async (state: typeof contestStates[number]) => {
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'Midterm', ${state.start}, ${state.end}, $1, $2)`, [state.status, state.isVisible]);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 2)');
    await moveProblemsToContest(1, ['cp-contest']);
  };

  const expectHiddenFromPublic = async () => {
    expect((await request(app).get('/problems/cp-contest')).status).toBe(404);
    expect((await request(app).get('/problems/cp-contest').set(asOutsider)).status).toBe(404);
    const list = await request(app).get('/problems');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('Secret Contest Title');
  };

  it.each(contestStates)('collection Show keeps a problem in a $label hidden from guests and non-participants', async (state) => {
    await seedContest(state);
    await expectHiddenFromPublic();

    const res = await request(app).put(`/admin/collections/${collectionId}/visibility`).set(asAdmin).send({ isVisible: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 1, skipped: 1, message: '1 problem shown; 1 in a contest skipped' });

    // Control: the standalone member of the collection really was shown.
    expect((await request(app).get('/problems/cp-pool')).status).toBe(200);
    await expectHiddenFromPublic();
  });

  it.each(contestStates)('single-problem Show (selection bar) keeps a problem in a $label hidden', async (state) => {
    await seedContest(state);
    const res = await request(app).put('/admin/problems/cp-contest/visibility').set(asAdmin).send({ isVisible: true });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/in a contest/);
    await expectHiddenFromPublic();
  });

  it('GET /problems/:id 404s a contest problem for non-staff even if is_visible is set; staff still read it', async () => {
    await seedContest(contestStates[1]);
    // Whatever wrote it (an older writer, a manual fix), is_visible alone never publishes a contest problem.
    await pool.query("UPDATE problems SET is_visible = true WHERE id = 'cp-contest'");

    await expectHiddenFromPublic();
    const participant = { 'x-test-role': 'user', 'x-test-user-id': '2', 'x-test-username': 'participant' };
    expect((await request(app).get('/problems/cp-contest').set(participant)).status).toBe(404);
    const staffView = await request(app).get('/problems/cp-contest').set(asAdmin);
    expect(staffView.status).toBe(200);
    expect(staffView.body.title).toBe('Secret Contest Title');
  });

  it('collection Show does not add running-contest submissions to the participant public profile', async () => {
    await seedContest(contestStates[1]);
    await pool.query(`INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score)
      VALUES (1, 2, 'cp-contest', 'x', 'cpp', 'Accepted', 100)`);
    const before = await getUserProfileStats('participant');
    expect(Number(before?.problems_solved)).toBe(0);

    await request(app).put(`/admin/collections/${collectionId}/visibility`).set(asAdmin).send({ isVisible: true });

    const after = await getUserProfileStats('participant');
    expect(Number(after?.problems_solved)).toBe(0);
    expect(Number(after?.submission_count)).toBe(0);
  });
});
