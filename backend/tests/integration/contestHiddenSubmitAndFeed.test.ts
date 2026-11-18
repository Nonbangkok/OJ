import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { getSubmissions, validateAndQueueSubmission } from '../../services/submissionQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * Contest surfaces while a contest runs:
 *  - A5-08: a hidden contest 404s on every read surface for non-staff, but
 *    POST /submit with its contestId is still accepted and judged for users
 *    who joined before it was hidden.
 *  - A5-09 / A8-06: the contest submission feed hands every participant the
 *    per-case statuses of every rival's submissions, the exact information
 *    the live scoreboard deliberately withholds (contestStandingsSql.ts:
 *    per-case results are snapshot-only).
 */
(databaseUrl ? describe : describe.skip)('running contest: hidden-contest submit and rival case statuses', () => {
  const schema = `chsf_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'u1', 'x', 'user'), (2, 'u2', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('a', 'Alpha', 'x', '{}', 1000, 256, false, 1, 1)`);
    await pool.query(`INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ('a', 1, '1', '1')`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1), (1, 2)');
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  describe('A5-08: submitting to a hidden contest', () => {
    it('a participant gets 404 once the contest is hidden, and nothing is queued', async () => {
      await pool.query('UPDATE contests SET is_visible = false WHERE id = 1');

      await expect(validateAndQueueSubmission(
        { problemId: 'a', language: 'cpp', code: 'int main(){}', contestId: '1' } as never, 1, 'user',
      )).rejects.toMatchObject({ statusCode: 404 });

      const count = (await pool.query('SELECT COUNT(*)::int AS n FROM contest_submissions')).rows[0].n;
      expect(count).toBe(0);
    });

    it('a visible running contest still accepts the participant (control)', async () => {
      const result = await validateAndQueueSubmission(
        { problemId: 'a', language: 'cpp', code: 'int main(){}', contestId: '1' } as never, 1, 'user',
      );
      expect(result.isContestSubmission).toBe(true);
    });
  });

  describe('A5-09: the contest feed during the round', () => {
    const submit = (userId: number, statuses: string[]) => pool.query(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results)
       VALUES (1, $1, 'a', 'x', 'cpp', 'Time Limit Exceeded', 50, $2::jsonb)`,
      [userId, JSON.stringify(statuses.map((status) => ({ status })))],
    );

    it("a participant does not see a rival's per-case statuses while the contest runs", async () => {
      await submit(1, ['Accepted', 'Wrong Answer']);
      await submit(2, ['Accepted', 'Accepted', 'Time Limit Exceeded', 'Time Limit Exceeded']);

      const rows = await getSubmissions({ filter: 'all', contestId: '1' } as never, 1, false);

      const own = rows.filter((r) => r.username === 'u1');
      expect(own).toHaveLength(1);
      expect(own[0].case_statuses).toEqual(['Accepted', 'Wrong Answer']);
      for (const rival of rows.filter((r) => r.username !== 'u1')) {
        expect(rival.case_statuses ?? []).toEqual([]);
      }
    });

    it('staff keep every per-case status while the contest runs (control)', async () => {
      await submit(2, ['Accepted', 'Time Limit Exceeded']);
      const rows = await getSubmissions({ filter: 'all', contestId: '1' } as never, 9, true);
      expect(rows.find((r) => r.username === 'u2')?.case_statuses).toEqual(['Accepted', 'Time Limit Exceeded']);
    });
  });
});
