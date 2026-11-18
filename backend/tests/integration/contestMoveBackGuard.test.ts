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
import { migrateSubmissionsAfterContest, moveProblemsToContest } from '../../services/problemMigration';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * The standings (live and the finish snapshot) count only the problems whose
 * `contest_id` is the contest (A5-03). The bulk move-back route
 * (POST /admin/contests/:id/problems, action move_to_main) therefore must not
 * run once the contest has ended: during 'finishing' (which can last up to
 * MIGRATION_MAX_DRAIN_DEFERRALS ticks while judges drain) it would empty the
 * final snapshot and every participant would finish with 0. A contest past
 * its end time that the scheduler has not flipped yet is just as over.
 */
(databaseUrl ? describe : describe.skip)('bulk move-back is refused once the contest has ended', () => {
  const schema = `cmbg_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'contest-move-back-guard-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.session.userId = 9;
    req.session.username = 'staffer';
    req.session.role = 'staff';
    next();
  });
  app.use(attachRequestUser);
  app.use(contestRoutes); app.use(errorHandler);

  const moveBack = () => request(app).post('/admin/contests/1/problems').send({ action: 'move_to_main', problemIds: ['a', 'b'] });
  const contestIdsOf = async () => (await pool.query('SELECT id, contest_id FROM problems ORDER BY id')).rows
    .map((r) => [r.id, r.contest_id]);
  const setContest = (status: string, endSql: string) =>
    pool.query(`UPDATE contests SET status = $1, end_time = ${endSql} WHERE id = 1`, [status]);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'u1', 'x', 'user'), (2, 'u2', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('a', 'A', 'x', '{}', 1000, 256, true), ('b', 'B', 'x', '{}', 1000, 256, true)`);
    await moveProblemsToContest(1, ['a', 'b']);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1), (1, 2)');
    await pool.query(`INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, submitted_at)
      VALUES (1, 1, 'a', 'x', 'cpp', 'Accepted', 100, NOW() - INTERVAL '30 minutes'),
             (1, 2, 'b', 'x', 'cpp', 'Accepted', 100, NOW() - INTERVAL '20 minutes')`);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('a finishing contest answers 409 and its final standings keep every score', async () => {
    await setContest('finishing', `NOW() - INTERVAL '1 minute'`);

    const res = await moveBack();
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/before the contest ends/i);
    expect(await contestIdsOf()).toEqual([['a', 1], ['b', 1]]);

    await migrateSubmissionsAfterContest(1);
    const board = await pool.query('SELECT user_id, total_score FROM contest_scoreboards WHERE contest_id = 1 ORDER BY user_id');
    expect(board.rows.map((r) => [r.user_id, r.total_score])).toEqual([[1, 100], [2, 100]]);
    const snapshot = await pool.query('SELECT problem_id FROM contest_problems WHERE contest_id = 1 ORDER BY problem_id');
    expect(snapshot.rows.map((r) => r.problem_id)).toEqual(['a', 'b']);
  });

  it('a running contest past its end time (the scheduler has not flipped it yet) answers 409', async () => {
    await setContest('running', `NOW() - INTERVAL '10 seconds'`);

    const res = await moveBack();
    expect(res.status).toBe(409);
    expect(await contestIdsOf()).toEqual([['a', 1], ['b', 1]]);
  });

  it('a finished contest answers 409', async () => {
    await setContest('finished', `NOW() - INTERVAL '1 hour'`);

    const res = await moveBack();
    expect(res.status).toBe(409);
  });

  it('an unknown contest answers 404', async () => {
    const res = await request(app).post('/admin/contests/77/problems').send({ action: 'move_to_main', problemIds: ['a'] });
    expect(res.status).toBe(404);
  });

  it.each([
    ['running', `NOW() + INTERVAL '1 hour'`],
    ['scheduled', `NOW() + INTERVAL '2 hours'`],
  ])('a %s contest still moves its problems back', async (status, endSql) => {
    await setContest(status, endSql);

    const res = await moveBack();
    expect(res.status).toBe(200);
    expect(res.body.movedProblems).toHaveLength(2);
    expect(await contestIdsOf()).toEqual([['a', null], ['b', null]]);
  });
});
