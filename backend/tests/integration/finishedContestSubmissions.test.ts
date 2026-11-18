import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { findSimilarContestPairs } from '../../services/similarityService';
import { getContestAnalytics, getUserAnalytics } from '../../services/analyticsQueryService';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * A5-04: staff review a contest (cheat detection, contest analytics) after the
 * round, i.e. once it is FINISHED. Finishing moves contest_submissions into
 * `submissions` and deletes them; the moved rows record their contest in
 * submissions.contest_id (migration 0029), and the finished contest's readers
 * use those rows. Running/finishing contests keep reading contest_submissions.
 */
(databaseUrl ? describe : describe.skip)('a finished contest keeps its submissions (A5-04)', () => {
  const schema = `fcs_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const T0 = new Date(Date.now() - 3 * 3600_000);
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

  const copied = `#include <iostream>
int main() { long long total = 0; for (int i = 1; i <= 100; i++) total += i * i;
std::cout << total << std::endl; return 0; }`;
  const copiedRenamed = `#include <iostream>
int main() { long long sumAcc = 0; for (int k = 1; k <= 100; k++) sumAcc += k * k;
std::cout << sumAcc << std::endl; return 0; }`;
  const original = `#include <iostream>
int main() { std::string s; std::getline(std::cin, s); std::reverse(s.begin(), s.end());
std::cout << s << std::endl; return 0; }`;

  const submit = (user: number, code: string, minutes: number) =>
    pool.query(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES (1, $1, 'a', $2, 'cpp', 'Accepted', 100, '[]'::jsonb, $3)`,
      [user, code, at(minutes)],
    );
  /** A practice submission after the contest, not part of it. */
  const practise = (user: number, code: string) =>
    pool.query(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES ($1, 'a', $2, 'cpp', 'Accepted', 100, '[]'::jsonb, NOW())`,
      [user, code],
    );
  const pairsOf = async () =>
    (await findSimilarContestPairs(1)).map((p) => [p.problemId, [p.userA, p.userB].sort()]);
  const contestStatus = async () => (await pool.query('SELECT status FROM contests WHERE id = 1')).rows[0].status;

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'alice', 'x', 'user'), (2, 'bob', 'x', 'user'), (3, 'carol', 'x', 'user')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible) VALUES (1, 'C', $1, $2, 'finishing', true)`,
      [T0, at(120)]);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('a', 'A', 'x', '{}', 1000, 256, false, 1, 1)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1), (1, 2), (1, 3)');
    await submit(1, copied, 30);
    await submit(2, copiedRenamed, 40);
    await submit(3, original, 50);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('cheat detection still reports the copied pair once the contest is finished', async () => {
    expect(await pairsOf()).toEqual([['a', ['alice', 'bob']]]);

    await migrateSubmissionsAfterContest(1);
    expect(await contestStatus()).toBe('finished');

    expect(await pairsOf()).toEqual([['a', ['alice', 'bob']]]);
  });

  it('a later practice submission is not taken for a contest one', async () => {
    await migrateSubmissionsAfterContest(1);
    // carol copies alice's program in practice, after the contest.
    await practise(3, copied);

    expect(await pairsOf()).toEqual([['a', ['alice', 'bob']]]);
  });

  it('the migrated rows record their contest; deleting the contest keeps them in practice', async () => {
    await migrateSubmissionsAfterContest(1);
    await practise(1, original);

    const rows = await pool.query('SELECT user_id, contest_id FROM submissions ORDER BY submitted_at');
    expect(rows.rows).toEqual([
      { user_id: 1, contest_id: 1 },
      { user_id: 2, contest_id: 1 },
      { user_id: 3, contest_id: 1 },
      { user_id: 1, contest_id: null },
    ]);

    await pool.query('DELETE FROM contests WHERE id = 1');
    const after = await pool.query('SELECT COUNT(*)::int AS n, COUNT(contest_id)::int AS linked FROM submissions');
    expect(after.rows).toEqual([{ n: 4, linked: 0 }]);
  });

  it('contest analytics of a finished contest read its migrated submissions', async () => {
    const live = await getContestAnalytics(1);
    expect(live?.kpis).toMatchObject({ submitters: 3, submissions: 3, accepted: 3 });

    await migrateSubmissionsAfterContest(1);
    await practise(1, original); // practice, not part of the contest

    const finished = await getContestAnalytics(1);
    expect(finished?.kpis).toMatchObject({ participants: 3, submitters: 3, submissions: 3, accepted: 3, maxScore: 100 });
    expect(finished?.submissionTimeline).toEqual([{ bucket: 'H0', count: 3 }]);
    expect(finished?.problemStats).toEqual([
      { problemId: 'a', title: 'A', submissions: 3, accepted: 3, acRate: 1, solvers: 3 },
    ]);
    expect(finished?.scoreboard.map((row) => [row.username, row.solved])).toEqual([
      ['alice', 1], ['bob', 1], ['carol', 1],
    ]);
  });

  it('the readers that UNION ALL both tables still count each submission once', async () => {
    expect((await getUserAnalytics(1))?.kpis.submissions).toBe(1);

    await migrateSubmissionsAfterContest(1);

    expect((await getUserAnalytics(1))?.kpis.submissions).toBe(1);
    const both = await pool.query(`SELECT COUNT(*)::int AS n FROM (
      SELECT id FROM submissions UNION ALL SELECT id FROM contest_submissions) s`);
    expect(both.rows).toEqual([{ n: 3 }]);
  });
});
