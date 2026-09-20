import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../../db';
import { enqueueJudgeTask } from '../../services/judgeQueue';
import { processContestSubmission, processSubmission } from '../../services/submissionService';
import { rejudgeContest, rejudgeProblem } from '../../services/rejudgeService';
import { runMigrationsFromPool } from '../../scripts/migrate';

jest.unmock('pg');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
// The rejudge service only enqueues; the pipeline itself is unit-tested
// elsewhere. Capture the enqueued tasks instead of compiling anything.
jest.mock('../../services/judgeQueue', () => ({ enqueueJudgeTask: jest.fn() }));
jest.mock('../../services/submissionService', () => ({
    processSubmission: jest.fn(),
    processContestSubmission: jest.fn(),
}));

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('batch rejudge (integration)', () => {
    const schema = `rejudge_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: databaseUrl });
    const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema });

    beforeAll(async () => {
        await admin.query(`CREATE SCHEMA ${schema}`);
        await runMigrationsFromPool(pool);
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE contest_submissions, submissions, testcases, problems, contests CASCADE');
        (db.query as jest.Mock).mockImplementation((sql: string, values?: unknown[]) => pool.query(sql, values));
        (db.pool.connect as jest.Mock).mockImplementation(() => pool.connect());
        (enqueueJudgeTask as jest.Mock).mockClear();
    });

    afterAll(async () => {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    });

    const insertProblem = (id: string) =>
        pool.query(`INSERT INTO problems (id, title, author, is_visible) VALUES ($1, $1, 'A', true)`, [id]);

    const insertContest = (id: number, status = 'running') =>
        pool.query(`INSERT INTO contests (id, title, start_time, end_time, status) VALUES ($1, $2, NOW(), NOW() + '1 day', $3)`, [id, `Contest ${id}`, status]);

    type InsertSubmission = {
        table: 'submissions' | 'contest_submissions';
        problemId: string;
        contestId?: number;
        code?: string;
        status?: string;
    };

    const insertSubmission = async ({ table, problemId, contestId, code = 'int main(){}', status = 'Accepted' }: InsertSubmission) => {
        if (table === 'contest_submissions') {
            const result = await pool.query(
                `INSERT INTO contest_submissions (contest_id, problem_id, code, language, overall_status, score, results)
                 VALUES ($1, $2, $3, 'cpp', $4, 100, $5) RETURNING id`,
                [contestId, problemId, code, status, JSON.stringify([{ status, output: 'stale verdict' }])]
            );
            return result.rows[0].id as number;
        }
        const result = await pool.query(
            `INSERT INTO submissions (problem_id, code, language, overall_status, score, results)
             VALUES ($1, $2, 'cpp', $3, 100, $4) RETURNING id`,
            [problemId, code, status, JSON.stringify([{ status, output: 'stale verdict' }])]
        );
        return result.rows[0].id as number;
    };

    const getRow = async (table: 'submissions' | 'contest_submissions', id: number) =>
        pool.query(`SELECT overall_status, results, code, language FROM ${table} WHERE id = $1`, [id]);

    describe('rejudgeProblem', () => {
        it('resets and enqueues submissions from both pools, skipping empty-code rows', async () => {
            await insertProblem('P1');
            await insertContest(1);
            const standaloneId = await insertSubmission({ table: 'submissions', problemId: 'P1' });
            const contestId1 = await insertSubmission({ table: 'contest_submissions', problemId: 'P1', contestId: 1 });
            const emptyCodeId = await insertSubmission({ table: 'submissions', problemId: 'P1', code: '' });
            // Unrelated problem — must stay untouched.
            await insertProblem('P2');
            const otherProblemId = await insertSubmission({ table: 'submissions', problemId: 'P2' });

            const result = await rejudgeProblem('P1');

            expect(result).toEqual({ queued: 2, skipped: 1 });
            expect(enqueueJudgeTask).toHaveBeenCalledTimes(2);

            const standalone = (await getRow('submissions', standaloneId)).rows[0];
            expect(standalone.overall_status).toBe('Pending');
            expect(standalone.results).toBeNull();
            expect(standalone.code).toBe('int main(){}');
            expect(standalone.language).toBe('cpp');

            const contestSub = (await getRow('contest_submissions', contestId1)).rows[0];
            expect(contestSub.overall_status).toBe('Pending');
            expect(contestSub.results).toBeNull();

            // Empty-code row is skipped, not reset and not enqueued.
            const skipped = (await getRow('submissions', emptyCodeId)).rows[0];
            expect(skipped.overall_status).toBe('Accepted');
            expect(skipped.results).not.toBeNull();

            // Other problems are untouched.
            const other = (await getRow('submissions', otherProblemId)).rows[0];
            expect(other.overall_status).toBe('Accepted');

            // The enqueued tasks target the right pipelines.
            const tasks = (enqueueJudgeTask as jest.Mock).mock.calls.map((call) => call[0] as () => Promise<void>);
            await Promise.all(tasks.map((task) => task()));
            expect(processSubmission).toHaveBeenCalledWith(standaloneId);
            expect(processContestSubmission).toHaveBeenCalledWith(contestId1);
        });
    });

    describe('rejudgeContest', () => {
        it('resets and enqueues only that contest submissions', async () => {
            await insertProblem('P1');
            await insertContest(1);
            await insertContest(2);
            const inContest = await insertSubmission({ table: 'contest_submissions', problemId: 'P1', contestId: 1 });
            const inOtherContest = await insertSubmission({ table: 'contest_submissions', problemId: 'P1', contestId: 2 });
            const standalone = await insertSubmission({ table: 'submissions', problemId: 'P1' });

            const result = await rejudgeContest(1);

            expect(result).toEqual({ queued: 1, skipped: 0 });
            expect(enqueueJudgeTask).toHaveBeenCalledTimes(1);

            const contestSub = (await getRow('contest_submissions', inContest)).rows[0];
            expect(contestSub.overall_status).toBe('Pending');
            expect(contestSub.results).toBeNull();

            // Other contest and standalone pool untouched.
            const otherContestSub = (await getRow('contest_submissions', inOtherContest)).rows[0];
            expect(otherContestSub.overall_status).toBe('Accepted');
            const standaloneRow = (await getRow('submissions', standalone)).rows[0];
            expect(standaloneRow.overall_status).toBe('Accepted');

            const tasks = (enqueueJudgeTask as jest.Mock).mock.calls.map((call) => call[0] as () => Promise<void>);
            await Promise.all(tasks.map((task) => task()));
            expect(processContestSubmission).toHaveBeenCalledWith(inContest);
            expect(processSubmission).not.toHaveBeenCalled();
        });
    });
});
