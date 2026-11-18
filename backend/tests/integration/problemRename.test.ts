import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import * as db from '../../db';
import problemRoutes from '../../controllers/problemController';
import { errorHandler } from '../../middleware/errorHandler';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { getContestScoreboard } from '../../services/contestScoreboardQueryService';

jest.unmock('pg');
jest.mock('../../middleware/auth', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireStaffOrAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

type Detail = { score: number };
type Row = { username: string; total_score: number; detailed_scores: Record<string, Detail> };

/**
 * Renaming a problem id (PUT /admin/problems/:id with a new `id`) cascades
 * the id by hand to every table without a foreign key. Two of those
 * cascades need care:
 *  - user_problem_rewards survives problem deletion, so the target id can
 *    still carry reward rows; the rename is refused with a 409 instead of
 *    hitting UNIQUE (user_id, problem_id) (a 500) or adopting the old solves.
 *  - the frozen board of a finished contest (contest_scoreboards.
 *    detailed_scores) is re-keyed with contest_problems, so the problem's
 *    column keeps its cells on the final board.
 */
(databaseUrl ? describe : describe.skip)('problem id rename cascade', () => {
  const schema = `rename_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const app = express();
  app.use(express.json());
  app.use(problemRoutes);
  app.use(errorHandler);
  const staff = { id: 9, role: 'staff' };

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, user_problem_rewards CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'u1', 'x', 'user'), (2, 'u2', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('renaming onto an id that still has reward rows from a deleted problem is refused with 409', async () => {
    // u1 solved 'sum' (since deleted: the reward row stays by design) and 'sum2'.
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('sum2', 'Sum Two', 'A', '{}', 1000, 256, true)`);
    await pool.query(`INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded)
      VALUES (1, 'sum', 10), (1, 'sum2', 20)`);

    const res = await request(app).put('/admin/problems/sum2').send({ id: 'sum' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/XP rewards/);
    // Refused cleanly: nothing moved.
    expect((await pool.query('SELECT id FROM problems ORDER BY id')).rows.map((r) => r.id)).toEqual(['sum2']);
    const rewards = (await pool.query('SELECT problem_id, xp_awarded FROM user_problem_rewards ORDER BY problem_id')).rows;
    expect(rewards).toEqual([{ problem_id: 'sum', xp_awarded: 10 }, { problem_id: 'sum2', xp_awarded: 20 }]);
  });

  it('renaming onto a free id carries the rewards along', async () => {
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('sum2', 'Sum Two', 'A', '{}', 1000, 256, true)`);
    await pool.query(`INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded) VALUES (1, 'sum2', 20)`);

    const res = await request(app).put('/admin/problems/sum2').send({ id: 'sum-two' });

    expect(res.status).toBe(200);
    expect((await pool.query('SELECT problem_id FROM user_problem_rewards')).rows).toEqual([{ problem_id: 'sum-two' }]);
  });

  it('renaming a problem after its contest finished keeps its cells on the frozen board', async () => {
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'finishing', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('sum2', 'Sum Two', 'A', '{}', 1000, 256, false, 1, 1)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1), (1, 2)');
    await pool.query(`INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
      VALUES (1, 1, 'sum2', 'x', 'cpp', 'Accepted', 100, '[{"status":"Accepted"}]'::jsonb, NOW() - INTERVAL '2 hours'),
             (1, 2, 'sum2', 'x', 'cpp', 'Wrong Answer', 40, '[{"status":"Wrong Answer"}]'::jsonb, NOW() - INTERVAL '2 hours')`);
    await migrateSubmissionsAfterContest(1);
    expect((await pool.query('SELECT status FROM contests WHERE id = 1')).rows[0].status).toBe('finished');

    const res = await request(app).put('/admin/problems/sum2').send({ id: 'sum-two' });
    expect(res.status).toBe(200);

    const board = (await getContestScoreboard('1', staff))!;
    expect(board.problems.map((p) => p.problem_id)).toEqual(['sum-two']);
    const rows = board.scoreboard as unknown as Row[];
    const byUser = Object.fromEntries(rows.map((r) => [r.username, r]));
    // Every problem column the board lists must still find its cells.
    expect(byUser.u1.detailed_scores['sum-two']).toMatchObject({ score: 100 });
    expect(byUser.u2.detailed_scores['sum-two']).toMatchObject({ score: 40 });
    expect(byUser.u1.detailed_scores.sum2).toBeUndefined();
    expect(byUser.u1.total_score).toBe(100);
  });
});
