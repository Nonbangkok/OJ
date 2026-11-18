import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { getSubmissionDetail, getSubmissions } from '../../services/submissionQueryService';
import { processContestSubmission, processSubmission } from '../../services/submissionService';
import { getJudgeQueueStats, resetInFlightTracking } from '../../services/judgeQueue';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
// The judges rejudge enqueues; stubbed so no compiler runs on the host.
jest.mock('../../services/submissionService', () => ({ processSubmission: jest.fn(), processContestSubmission: jest.fn() }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * Once a contest has finished, its problem page counts the viewer's moved
 * submissions (submissions.contest_id, migration 0029). The contest
 * submissions feed and the contest submission detail must agree: they read
 * the same moved rows, under the same access rules as before (owner or staff
 * for the detail; rivals' per-case statuses are hidden only until the contest
 * finishes). The moved rows have new ids, so the contest detail must only
 * ever answer with a row of that contest — never an unrelated practice
 * submission that happens to carry the id.
 */
(databaseUrl ? describe : describe.skip)('finished contest submissions feed and detail', () => {
  const schema = `fcsf_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const ALICE = 1;
  const BOB = 2;

  const contestSubmit = async (user: number, problem: string, score: number, statuses: string[], minutes: number) =>
    (await pool.query<{ id: number }>(
      `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, results, submitted_at)
       VALUES (1, $1, $2, '// contest code', 'cpp', $3, $4, $5::jsonb, NOW() - make_interval(mins => $6)) RETURNING id`,
      [user, problem, score === 100 ? 'Accepted' : 'Wrong Answer', score,
        JSON.stringify(statuses.map((status, i) => ({ testCase: i + 1, status }))), 90 - minutes],
    )).rows[0].id;
  const practise = async (user: number, problem: string) =>
    (await pool.query<{ id: number }>(
      `INSERT INTO submissions (user_id, problem_id, code, language, overall_status, score, results)
       VALUES ($1, $2, '// practice code', 'cpp', 'Accepted', 100, '[]'::jsonb) RETURNING id`,
      [user, problem],
    )).rows[0].id;
  const finish = async () => {
    await pool.query("UPDATE contests SET status = 'finishing', end_time = NOW() - INTERVAL '1 minute' WHERE id = 1");
    await migrateSubmissionsAfterContest(1);
  };
  const movedIds = async () =>
    (await pool.query<{ id: number }>('SELECT id FROM submissions WHERE contest_id = 1 ORDER BY submitted_at')).rows.map((r) => r.id);
  const feed = (query: Record<string, string>, user: number, staff = false) =>
    getSubmissions({ contestId: '1', ...query } as never, user, staff);
  const waitForIdleQueue = async () => {
    const deadline = Date.now() + 10_000;
    while (getJudgeQueueStats().running > 0 || getJudgeQueueStats().queued > 0) {
      if (Date.now() > deadline) throw new Error('judge queue did not go idle');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    resetInFlightTracking();
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    (processSubmission as jest.Mock).mockReset();
    (processContestSubmission as jest.Mock).mockReset();
    await pool.query(`INSERT INTO users (id, username, password_hash, role)
      VALUES (1, 'alice', 'x', 'user'), (2, 'bob', 'x', 'user'), (9, 'staffer', 'x', 'staff')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '1 hour', 'running', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('a', 'Alpha', 'x', '{}', 1000, 256, false, 1, 1), ('b', 'Beta', 'x', '{}', 1000, 256, false, 1, 2)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible)
      VALUES ('p', 'Practice', 'x', '{}', 1000, 256, true)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1), (1, 2)');
    await contestSubmit(ALICE, 'a', 40, ['Accepted', 'Wrong Answer'], 10);
    await contestSubmit(ALICE, 'a', 100, ['Accepted', 'Accepted'], 20);
    await contestSubmit(BOB, 'a', 0, ['Wrong Answer', 'Skipped'], 30);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  describe('feed', () => {
    it("lists the viewer's moved rows on the problem page tab, matching its count", async () => {
      await finish();
      await practise(ALICE, 'a'); // practice after the contest, not part of it

      const mine = await feed({ problemId: 'a', filter: 'mine' }, ALICE);
      expect(mine.map((row) => [row.username, row.score])).toEqual([['alice', 100], ['alice', 40]]);
      expect(mine.map((row) => row.id).sort()).toEqual((await movedIds()).slice(0, 2).sort());
    });

    it('shows everyone the per-case statuses once finished, as before', async () => {
      const live = await feed({}, BOB);
      expect(live.find((row) => row.username === 'alice')?.case_statuses).toEqual([]);

      await finish();

      const finished = await feed({}, BOB);
      expect(finished.map((row) => row.username)).toEqual(['bob', 'alice', 'alice']);
      expect(finished.find((row) => row.score === 100)?.case_statuses).toEqual(['Accepted', 'Accepted']);
    });

    it('stays empty for a contest that finished before migration 0029 (rows without a contest link)', async () => {
      await finish();
      await pool.query('UPDATE submissions SET contest_id = NULL');

      expect(await feed({}, ALICE)).toEqual([]);
    });
  });

  describe('detail', () => {
    it('serves a moved row under its contest', async () => {
      await finish();
      const [first] = await movedIds();

      const detail = await getSubmissionDetail(String(first), '1');
      expect(detail).toMatchObject({ id: first, user_id: ALICE, score: 40, problem_name: 'Alpha', code: '// contest code' });
    });

    it('never answers with an unrelated practice submission that carries the id', async () => {
      const practiceId = await practise(ALICE, 'p');
      await finish();

      expect(await getSubmissionDetail(String(practiceId), '1')).toBeNull();
      // ...nor with a moved row under another contest's id.
      const [first] = await movedIds();
      expect(await getSubmissionDetail(String(first), '2')).toBeNull();
      // The practice route still serves it as before.
      expect(await getSubmissionDetail(String(practiceId))).toMatchObject({ id: practiceId, problem_name: 'Practice' });
    });

    it('serves the contest row while the contest runs, as before', async () => {
      const contestRow = (await pool.query<{ id: number }>('SELECT id FROM contest_submissions ORDER BY id LIMIT 1')).rows[0].id;
      expect(await getSubmissionDetail(String(contestRow), '1')).toMatchObject({ id: contestRow, contest_id: 1, score: 40 });
    });
  });

  afterEach(async () => {
    await waitForIdleQueue();
    resetInFlightTracking();
  });
});
