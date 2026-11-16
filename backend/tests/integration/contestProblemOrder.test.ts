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
import { contestProblemPositionBackfillSql } from '../../migrations/0026ContestProblemPosition';
import { moveProblemsBackToMain, moveProblemsToContest, migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { getContestDetail, moveSingleProblemToMainSystem } from '../../services/contestQueryService';
import { getContestProblemsForParticipant } from '../../services/contestParticipantQueryService';
import { getContestScoreboard } from '../../services/contestScoreboardQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('contest problem order (B4)', () => {
  const schema = `cpo_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'cpo-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const role = req.header('x-test-role');
    if (role) { req.session.userId = 1; req.session.username = 'staffer'; req.session.role = role; } next(); });
  app.use(attachRequestUser);
  app.use(contestRoutes); app.use(errorHandler);

  const student = { id: 2, role: 'user' };
  const ids = (rows: Array<{ id?: string; problem_id?: string }>) => rows.map((r) => r.id ?? r.problem_id);
  const positions = async () => (await pool.query(
    'SELECT id, contest_position FROM problems WHERE id IN ($1, $2, $3) ORDER BY id', ['a', 'b', 'c'],
  )).rows.map((r) => [r.id, r.contest_position]);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users CASCADE');
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'staffer', 'x', 'staff'), (2, 'u2', 'x', 'user')");
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('a', 'Alpha', 'A', '{}', 1000, 256, true), ('b', 'Beta', 'A', '{}', 1000, 256, true), ('c', 'Gamma', 'A', '{}', 1000, 256, true)`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'Mid-term', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 2)');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const assignBAC = async () => { await moveProblemsToContest(1, ['b', 'a']); await moveProblemsToContest(1, ['c']); };

  it('assigning problems appends positions in the given order', async () => {
    await assignBAC();
    expect(await positions()).toEqual([['a', 2], ['b', 1], ['c', 3]]);
  });

  it('removing a problem clears its position', async () => {
    await assignBAC();
    await moveSingleProblemToMainSystem('1', 'a');
    await moveProblemsBackToMain(1, ['c']);
    expect(await positions()).toEqual([['a', null], ['b', 1], ['c', null]]);
  });

  it('contest lists order by position, then id', async () => {
    await assignBAC();
    const participant = await getContestProblemsForParticipant('1', 2, student);
    expect(participant.kind === 'ok' && ids(participant.data)).toEqual(['b', 'a', 'c']);
    expect(ids((await getContestDetail('1', student))!.problems)).toEqual(['b', 'a', 'c']);
    expect(ids((await getContestScoreboard('1', student))!.problems)).toEqual(['b', 'a', 'c']);
  });

  it('the finish snapshot keeps the order', async () => {
    await assignBAC();
    await pool.query("UPDATE contests SET status = 'finishing' WHERE id = 1");
    await migrateSubmissionsAfterContest(1);
    await pool.query("UPDATE contests SET status = 'finished' WHERE id = 1");
    const snap = await pool.query('SELECT problem_id, position FROM contest_problems WHERE contest_id = 1 ORDER BY position');
    expect(snap.rows.map((r) => [r.problem_id, r.position])).toEqual([['b', 1], ['a', 2], ['c', 3]]);
    const participant = await getContestProblemsForParticipant('1', 2, student);
    expect(participant.kind === 'ok' && ids(participant.data)).toEqual(['b', 'a', 'c']);
    expect(ids((await getContestDetail('1', student))!.problems)).toEqual(['b', 'a', 'c']);
    expect(ids((await getContestScoreboard('1', student))!.problems)).toEqual(['b', 'a', 'c']);
  });

  it('reorder rewrites positions 1..n', async () => {
    await assignBAC();
    await request(app).put('/admin/contests/1/problem-order').set('x-test-role', 'staff')
      .send({ problemIds: ['c', 'b', 'a'] }).expect(204);
    expect(await positions()).toEqual([['a', 3], ['b', 2], ['c', 1]]);
  });

  it('reorder rejects a different set (400)', async () => {
    await assignBAC();
    await request(app).put('/admin/contests/1/problem-order').set('x-test-role', 'staff')
      .send({ problemIds: ['c', 'b'] }).expect(400);
  });

  it('reorder of a finished contest is 409', async () => {
    await assignBAC();
    await pool.query("UPDATE contests SET status = 'finished' WHERE id = 1");
    await request(app).put('/admin/contests/1/problem-order').set('x-test-role', 'staff')
      .send({ problemIds: ['c', 'b', 'a'] }).expect(409);
  });

  it('non-staff reorder is 403', async () => {
    await assignBAC();
    await request(app).put('/admin/contests/1/problem-order').set('x-test-role', 'user')
      .send({ problemIds: ['c', 'b', 'a'] }).expect(403);
  });

  it('detail carries problem_count for a non-participant of a running contest, with problems []', async () => {
    await assignBAC();
    const detail = await getContestDetail('1', { id: 1, role: 'user' });
    expect(detail).toMatchObject({ problem_count: 3, problems: [], is_participant: false });
  });

  it('migration backfills positions by id for existing assigned problems and snapshots', async () => {
    await pool.query('UPDATE problems SET contest_id = 1, contest_position = NULL');
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (2, 'Old', NOW() - INTERVAL '3 hour', NOW() - INTERVAL '2 hour', 'finished', true)`);
    await pool.query(`INSERT INTO contest_problems (contest_id, problem_id, title) VALUES (2, 'z', 'Z'), (2, 'y', 'Y')`);
    await pool.query(contestProblemPositionBackfillSql);
    expect(await positions()).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    const snap = await pool.query('SELECT problem_id, position FROM contest_problems WHERE contest_id = 2 ORDER BY problem_id');
    expect(snap.rows.map((r) => [r.problem_id, r.position])).toEqual([['y', 1], ['z', 2]]);
  });
});
