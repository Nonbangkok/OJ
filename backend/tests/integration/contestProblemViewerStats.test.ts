import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import {
  getContestProblemDetailForParticipant,
  getContestProblemsForParticipant,
} from '../../services/contestParticipantQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A7-03: the problem page shows the viewer's attempt count (the Submissions
 * tab) and best result (the score strip in the header) from
 * viewerSubmissionCount / viewerBest. The contest problem detail sends them
 * too, from the viewer's own contest submissions: contest_submissions while
 * the contest runs or finishes, the migrated submissions (contest_id) once it
 * has finished. The contest problem list's finished branch reads the same rows.
 */
(databaseUrl ? describe : describe.skip)('contest problem viewer stats (A7-03)', () => {
  const schema = `cpvs_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const staff = { id: 9, role: 'staff' };

  const submit = (user: number, problem: string, score: number, statuses: string[], minutes: number) =>
    pool.query(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES (1, $1, $2, 'int main(){}', 'cpp', $3, $4, $5::jsonb, NOW() - make_interval(mins => $6))`,
      [user, problem, score === 100 ? 'Accepted' : 'Wrong Answer', score,
        JSON.stringify(statuses.map((status, i) => ({ testCase: i + 1, status }))), 90 - minutes],
    );
  const detail = async (user: number, viewer?: { id: number; role: string }) => {
    const result = await getContestProblemDetailForParticipant('1', 'a', user, viewer ?? { id: user, role: 'user' });
    expect(result.kind).toBe('ok');
    const { viewerBest, viewerSubmissionCount } = (result as unknown as { data: Record<string, unknown> }).data;
    return { viewerBest, viewerSubmissionCount };
  };
  const mine = { viewerBest: { score: 60, caseStatuses: ['Accepted', 'Accepted', 'Wrong Answer'] }, viewerSubmissionCount: 3 };

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'u1', 'x', 'user'), (2, 'u2', 'x', 'user'), (3, 'u3', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('a', 'Alpha', 'x', '{}', 1000, 256, false, 1, 1), ('b', 'Beta', 'x', '{}', 1000, 256, false, 1, 2)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1), (1, 2), (1, 3)');
    await submit(1, 'a', 30, ['Accepted', 'Wrong Answer', 'Skipped'], 10);
    await submit(1, 'a', 60, ['Accepted', 'Accepted', 'Wrong Answer'], 20);
    await submit(1, 'a', 40, ['Accepted', 'Wrong Answer', 'Skipped'], 30);
    await submit(1, 'b', 100, ['Accepted'], 40); // another problem
    await submit(2, 'a', 100, ['Accepted', 'Accepted', 'Accepted'], 50); // a rival
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it("sends the viewer's own count and best on a running contest's problem", async () => {
    expect(await detail(1)).toEqual(mine);
    expect(await detail(3)).toEqual({ viewerBest: null, viewerSubmissionCount: 0 });
    // Staff watching without joining have no submissions of their own.
    expect(await detail(9, staff)).toEqual({ viewerBest: null, viewerSubmissionCount: 0 });
  });

  it('keeps them once the contest has finished, from the migrated rows only', async () => {
    await pool.query("UPDATE contests SET status = 'finishing', end_time = NOW() - INTERVAL '1 minute' WHERE id = 1");
    expect(await detail(1)).toEqual(mine);

    await migrateSubmissionsAfterContest(1);
    expect((await pool.query('SELECT status FROM contests WHERE id = 1')).rows[0].status).toBe('finished');
    // Practice after the contest is not part of it.
    await pool.query(`INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results)
      VALUES (1, 'a', 'int main(){}', 'cpp', 'Accepted', 100, '[]'::jsonb)`);

    expect(await detail(1)).toEqual(mine);
  });

  it("the finished contest's problem list carries the viewer's contest results", async () => {
    await pool.query("UPDATE contests SET status = 'finishing', end_time = NOW() - INTERVAL '1 minute' WHERE id = 1");
    await migrateSubmissionsAfterContest(1);

    const list = await getContestProblemsForParticipant('1', 1, { id: 1, role: 'user' });
    expect(list.kind).toBe('ok');
    const rows = (list as unknown as { data: Array<Record<string, unknown>> }).data
      .map(({ id, best_score, submission_count }) => ({ id, best_score, submission_count: Number(submission_count) }));
    expect(rows).toEqual([
      { id: 'a', best_score: 60, submission_count: 3 },
      { id: 'b', best_score: 100, submission_count: 1 },
    ]);
  });
});
