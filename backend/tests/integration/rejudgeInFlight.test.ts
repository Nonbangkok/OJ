import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { enqueueTrackedJudgeTask, isSubmissionInFlight } from '../../services/judgeQueue';
import { rejudgeContest, rejudgeProblem } from '../../services/rejudgeService';
import { runMigrationsFromPool } from '../../scripts/migrate';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../services/judgeQueue', () => ({
  enqueueTrackedJudgeTask: jest.fn(),
  isSubmissionInFlight: jest.fn(() => false),
}));
jest.mock('../../services/submissionService', () => ({
  processSubmission: jest.fn(),
  processContestSubmission: jest.fn(),
}));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * Rejudge must leave rows whose judge is still in flight untouched
 * (JUDGE-004: they are counted as `busy` and not re-enqueued). A row whose
 * pipeline has already written its final verdict but not yet released its
 * in-flight key would otherwise be wiped back to Pending/NULL and never
 * judged again (stuck until a restart).
 */
(databaseUrl ? describe : describe.skip)('rejudge leaves in-flight rows untouched', () => {
  const schema = `rjflight_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await runMigrationsFromPool(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE contest_submissions, submissions, problems, contests CASCADE');
    (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
    (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
    (enqueueTrackedJudgeTask as jest.Mock).mockClear();
    await pool.query(`INSERT INTO problems (id, title, author, is_visible) VALUES ('P1', 'P1', 'A', true)`);
    await pool.query(`INSERT INTO contests (id, title, start_time, end_time, status) VALUES (1, 'C', NOW(), NOW() + '1 day', 'running')`);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const insert = async (table: 'submissions' | 'contest_submissions'): Promise<number> => {
    const verdict = JSON.stringify([{ status: 'Accepted', output: 'fresh verdict' }]);
    const result = table === 'contest_submissions'
      ? await pool.query(`INSERT INTO contest_submissions (contest_id, problem_id, code, language, overall_status, score, results)
          VALUES (1, 'P1', 'int main(){}', 'cpp', 'Accepted', 100, $1) RETURNING id`, [verdict])
      : await pool.query(`INSERT INTO submissions (problem_id, code, language, overall_status, score, results)
          VALUES ('P1', 'int main(){}', 'cpp', 'Accepted', 100, $1) RETURNING id`, [verdict]);
    return result.rows[0].id as number;
  };
  const row = async (table: string, id: number) =>
    (await pool.query(`SELECT overall_status, score, results FROM ${table} WHERE id = $1`, [id])).rows[0];

  it('a standalone row whose verdict just landed (still in flight) keeps that verdict', async () => {
    const busyId = await insert('submissions');
    const idleId = await insert('submissions');
    (isSubmissionInFlight as jest.Mock).mockImplementation(({ table, submissionId }) =>
      table === 'submissions' && submissionId === busyId);

    const result = await rejudgeProblem('P1');

    expect(result).toMatchObject({ queued: 1, busy: 1 });
    expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(1);
    // The busy row is not re-enqueued, so it must not be reset either.
    expect(await row('submissions', busyId)).toMatchObject({ overall_status: 'Accepted', score: 100 });
    expect((await row('submissions', busyId)).results).not.toBeNull();
    // The idle row is reset as usual.
    expect(await row('submissions', idleId)).toMatchObject({ overall_status: 'Pending', results: null });
  });

  it('a contest row whose verdict just landed (still in flight) keeps that verdict', async () => {
    const busyId = await insert('contest_submissions');
    (isSubmissionInFlight as jest.Mock).mockImplementation(({ table, submissionId }) =>
      table === 'contest_submissions' && submissionId === busyId);

    const result = await rejudgeContest(1);

    expect(result).toMatchObject({ queued: 0, busy: 1 });
    expect(enqueueTrackedJudgeTask).not.toHaveBeenCalled();
    expect(await row('contest_submissions', busyId)).toMatchObject({ overall_status: 'Accepted', score: 100 });
    expect((await row('contest_submissions', busyId)).results).not.toBeNull();
  });
});
