import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { runMigrationsFromPool } from '../../scripts/migrate';
import { JUDGE_CONFIG, SUBMISSION_STATUS } from '../../constants';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import { processSubmission } from '../../services/submissionService';
import {
  enqueueJudgeTask,
  enqueueTrackedJudgeTask,
  getContestInFlightCount,
  getJudgeQueueStats,
  resetInFlightTracking,
} from '../../services/judgeQueue';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
// The practice-pool judge the migration re-enqueues; stubbed per test so no
// compiler runs on the host.
jest.mock('../../services/submissionService', () => ({ processSubmission: jest.fn() }));
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * Contest-end migration (`migrateSubmissionsAfterContest`, run by the
 * scheduler for every 'finishing' contest).
 *
 * A5-02: it drains the contest's in-flight judges for at most
 * CONTEST_MIGRATION_DRAIN_TIMEOUT_MS. A contest submission that is merely
 * QUEUED behind other judge work (MAX_CONCURRENT_JUDGES is 1, one global
 * FIFO) when that bound runs out must still end up judged, both in the
 * migrated `submissions` row and in the frozen final scoreboard: the
 * migration defers (writes nothing, the contest stays 'finishing') and a
 * later tick finishes once the judge has landed its verdict. When the
 * scheduler finally finishes with judges still in flight, every migrated row
 * without a verdict is re-judged in the practice pool.
 *
 * The queued contest judge below mirrors runSubmissionPipeline: it re-reads
 * its contest_submissions row (returning when it is gone) and lands its
 * verdict with the pipeline's conditional final UPDATE.
 */
(databaseUrl ? describe : describe.skip)('contest finish migration', () => {
  const schema = `cfm_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });
  const config = JUDGE_CONFIG as unknown as { CONTEST_MIGRATION_DRAIN_TIMEOUT_MS: number };
  const originalDrainTimeout = config.CONTEST_MIGRATION_DRAIN_TIMEOUT_MS;

  const waitFor = async (predicate: () => boolean, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the judge queue');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const queueIdle = () => getJudgeQueueStats().running === 0 && getJudgeQueueStats().queued === 0;

  /** One scheduler tick's migration attempt; the scheduler swallows and retries failures. */
  const schedulerTick = async () => {
    try { await migrateSubmissionsAfterContest(1); } catch { /* retried next tick */ }
  };

  const insertContestSubmission = async (status: string) => (await pool.query<{ id: number }>(
    `INSERT INTO contest_submissions (contest_id, user_id, problem_id, code, language, overall_status, score, submitted_at)
     VALUES (1, 1, 'a', 'int main(){}', 'cpp', $1, 0, NOW() - INTERVAL '2 minutes') RETURNING id`,
    [status],
  )).rows[0].id;

  /** Holds the only judge slot until released. */
  const holdJudgeSlot = () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    enqueueJudgeTask(() => held);
    return release;
  };

  /** A contest judge for the row, queued behind whatever holds the slot. */
  const queueContestJudge = (contestSubmissionId: number) => enqueueTrackedJudgeTask(async () => {
    const row = await db.query('SELECT id FROM contest_submissions WHERE id = $1', [contestSubmissionId]);
    if (row.rows.length === 0) return; // runSubmissionPipeline: 'submission not found for processing'
    await db.query(
      `UPDATE contest_submissions SET overall_status = $1, score = 100, results = '[{"status":"Accepted"}]'::jsonb
       WHERE id = $2 AND overall_status IN ('Pending', 'Compiling', 'Running')`,
      [SUBMISSION_STATUS.ACCEPTED, contestSubmissionId],
    );
  }, { table: 'contest_submissions', submissionId: contestSubmissionId }, 1);

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    resetInFlightTracking();
    config.CONTEST_MIGRATION_DRAIN_TIMEOUT_MS = 300;
    await pool.query('TRUNCATE contests, problems, users, submissions CASCADE');
    (db.query as jest.Mock).mockImplementation((sql, values) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    (processSubmission as jest.Mock).mockReset();
    await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'user')`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status, is_visible)
      VALUES (1, 'C', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 minute', 'finishing', true)`);
    await pool.query(`INSERT INTO problems (id, title, author, categories, time_limit_ms, memory_limit_mb, is_visible, contest_id, contest_position)
      VALUES ('a', 'A', 'x', '{}', 1000, 256, false, 1, 1)`);
    await pool.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (1, 1)');
  });
  afterEach(async () => {
    config.CONTEST_MIGRATION_DRAIN_TIMEOUT_MS = originalDrainTimeout;
    await waitFor(queueIdle);
    resetInFlightTracking();
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  it('A5-02: a last-minute submission still queued at the drain bound is judged and counted in the final standings', async () => {
    const contestSubmissionId = await insertContestSubmission(SUBMISSION_STATUS.PENDING);
    const releaseBacklog = holdJudgeSlot();
    queueContestJudge(contestSubmissionId);
    expect(getContestInFlightCount(1)).toBe(1);

    // Scheduler tick: the drain bound runs out while the contest judge is still queued.
    const deferred = await migrateSubmissionsAfterContest(1);
    expect(deferred).toMatchObject({ success: false, deferred: true });
    expect((await pool.query('SELECT status FROM contests WHERE id = 1')).rows[0].status).toBe('finishing');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM submissions')).rows[0].n).toBe(0);

    // The backlog clears and the queued judge runs.
    releaseBacklog();
    await waitFor(() => getContestInFlightCount(1) === 0 && queueIdle());

    // Later ticks, while the contest is still finishing.
    for (let tick = 0; tick < 3; tick++) {
      const { rows } = await pool.query('SELECT status FROM contests WHERE id = 1');
      if (rows[0].status !== 'finishing') break;
      await schedulerTick();
    }
    await waitFor(() => getContestInFlightCount(1) === 0 && queueIdle());

    const contest = await pool.query('SELECT status FROM contests WHERE id = 1');
    expect(contest.rows[0].status).toBe('finished');

    const migrated = await pool.query(`SELECT overall_status, score FROM submissions WHERE user_id = 1 AND problem_id = 'a'`);
    expect(migrated.rows).toEqual([{ overall_status: SUBMISSION_STATUS.ACCEPTED, score: 100 }]);

    const finalBoard = await pool.query('SELECT total_score FROM contest_scoreboards WHERE contest_id = 1 AND user_id = 1');
    expect(finalBoard.rows).toEqual([{ total_score: 100 }]);
  });

  it('A5-02: finishing with judges still in flight re-judges every unjudged migrated row in the practice pool', async () => {
    const queuedId = await insertContestSubmission(SUBMISSION_STATUS.PENDING);
    await insertContestSubmission(SUBMISSION_STATUS.RUNNING); // caught mid-judge
    const judgedId = await insertContestSubmission(SUBMISSION_STATUS.ACCEPTED);
    await pool.query('UPDATE contest_submissions SET score = 100 WHERE id = $1', [judgedId]);
    const releaseBacklog = holdJudgeSlot();
    queueContestJudge(queuedId);
    // The practice-pool judge: lands a verdict on the migrated copy.
    (processSubmission as jest.Mock).mockImplementation(async (submissionId: number) => {
      await pool.query(
        `UPDATE submissions SET overall_status = 'Wrong Answer', score = 40
         WHERE id = $1 AND overall_status IN ('Pending', 'Compiling', 'Running')`,
        [submissionId],
      );
    });

    const result = await migrateSubmissionsAfterContest(1, { proceedWithJudgesInFlight: true });
    expect(result).toMatchObject({ success: true, migratedSubmissions: 3 });
    expect((await pool.query('SELECT status FROM contests WHERE id = 1')).rows[0].status).toBe('finished');

    // Rows without a verdict land as Pending (so a restart's sweep would re-enqueue them too).
    const atFinish = await pool.query(`SELECT overall_status FROM submissions ORDER BY submitted_at, id`);
    expect(atFinish.rows.map((r) => r.overall_status).sort()).toEqual(['Accepted', 'Pending', 'Pending']);

    releaseBacklog();
    await waitFor(queueIdle);

    // The stale contest judge stepped aside; both unjudged copies were re-judged, the judged one untouched.
    expect(processSubmission).toHaveBeenCalledTimes(2);
    const after = await pool.query(`SELECT overall_status, score FROM submissions ORDER BY overall_status`);
    expect(after.rows).toEqual([
      { overall_status: 'Accepted', score: 100 },
      { overall_status: 'Wrong Answer', score: 40 },
      { overall_status: 'Wrong Answer', score: 40 },
    ]);
    // The frozen final board keeps the scores the rows had at finish.
    const finalBoard = await pool.query('SELECT total_score FROM contest_scoreboards WHERE contest_id = 1 AND user_id = 1');
    expect(finalBoard.rows).toEqual([{ total_score: 100 }]);
  });

  it('rolls back as one unit: a failure after the problems move back leaves them in the contest', async () => {
    const accepted = await insertContestSubmission(SUBMISSION_STATUS.ACCEPTED);
    await pool.query('UPDATE contest_submissions SET score = 100 WHERE id = $1', [accepted]);
    // Fail the last statement of the migration (status -> finished).
    await pool.query(`CREATE FUNCTION ${schema}.fail_finish() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'finish refused for the test'; END $$`);
    await pool.query(`CREATE TRIGGER fail_finish BEFORE UPDATE ON contests
      FOR EACH ROW WHEN (NEW.status = 'finished') EXECUTE FUNCTION ${schema}.fail_finish()`);
    try {
      await expect(migrateSubmissionsAfterContest(1)).rejects.toThrow('finish refused for the test');
    } finally {
      await pool.query('DROP TRIGGER fail_finish ON contests');
      await pool.query(`DROP FUNCTION ${schema}.fail_finish()`);
    }

    const problem = await pool.query(`SELECT contest_id, is_visible FROM problems WHERE id = 'a'`);
    expect(problem.rows).toEqual([{ contest_id: 1, is_visible: false }]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM contest_submissions')).rows[0].n).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM submissions')).rows[0].n).toBe(0);

    // The retry on the next tick then finishes with the full standings.
    await migrateSubmissionsAfterContest(1);
    expect((await pool.query('SELECT status FROM contests WHERE id = 1')).rows[0].status).toBe('finished');
    const finalBoard = await pool.query('SELECT total_score FROM contest_scoreboards WHERE contest_id = 1 AND user_id = 1');
    expect(finalBoard.rows).toEqual([{ total_score: 100 }]);
  });
});
