import { rejudgeContest, rejudgeProblem } from '../../services/rejudgeService';
import * as db from '../../db';
import { enqueueTrackedJudgeTask, isSubmissionInFlight } from '../../services/judgeQueue';
import { processContestSubmission, processSubmission } from '../../services/submissionService';
import { logger } from '../../utils/logger';

jest.mock('../../db');
jest.mock('../../services/judgeQueue', () => ({
    enqueueTrackedJudgeTask: jest.fn(),
    isSubmissionInFlight: jest.fn(() => false),
}));
jest.mock('../../services/submissionService', () => ({
    processSubmission: jest.fn(),
    processContestSubmission: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

type JudgeTask = () => Promise<void>;
type PoolTable = 'submissions' | 'contest_submissions';
type StatementKind = 'select' | 'reset' | 'count';
type Candidate = { id: number; contest_id?: number | null };
type PoolFixture = { candidates: Candidate[]; skipped?: number };

const tableOf = (sql: string): PoolTable => (sql.includes('contest_submissions') ? 'contest_submissions' : 'submissions');
const kindOf = (sql: string): StatementKind => {
    const head = sql.trimStart();
    if (head.startsWith('UPDATE')) return 'reset';
    if (head.includes('COUNT(*)')) return 'count';
    return 'select';
};

/** Answers the service's statements per pool (candidates, reset, skipped count) from fixtures. */
const mockPools = (pools: Partial<Record<PoolTable, PoolFixture>>) => {
    (db.query as jest.Mock).mockImplementation(async (sql: string, values: unknown[]) => {
        const pool = pools[tableOf(sql)] ?? { candidates: [] };
        const rows = pool.candidates.map((row) => ({ contest_id: null, ...row }));
        switch (kindOf(sql)) {
            case 'select': return { rows };
            case 'reset': return { rows: rows.filter((row) => (values[1] as number[]).includes(row.id)) };
            default: return { rows: [{ count: pool.skipped ?? 0 }] };
        }
    });
};

const callsOf = (table: PoolTable, kind: StatementKind): [string, unknown[]][] =>
    (db.query as jest.Mock).mock.calls.filter(([sql]) => tableOf(sql) === table && kindOf(sql) === kind);

describe('Rejudge Service', () => {
    let queuedTasks: JudgeTask[];

    beforeEach(() => {
        queuedTasks = [];
        (enqueueTrackedJudgeTask as jest.Mock).mockImplementation((task: JudgeTask) => {
            queuedTasks.push(task);
        });
        (isSubmissionInFlight as jest.Mock).mockImplementation(() => false);
    });

    describe('rejudgeProblem', () => {
        it('resets and enqueues judgeable rows from both pools, counting empty-code rows as skipped', async () => {
            mockPools({
                submissions: { candidates: [{ id: 1 }, { id: 2 }], skipped: 1 },
                contest_submissions: { candidates: [{ id: 7, contest_id: 3 }] },
            });

            const result = await rejudgeProblem('P1');

            expect(result).toEqual({ queued: 3, skipped: 1, busy: 0 });

            // Candidates are the judgeable rows of the problem.
            const [selectSql, selectValues] = callsOf('submissions', 'select')[0];
            expect(selectSql).toContain('problem_id = $1');
            expect(selectSql).toContain("COALESCE(code, '') <> ''");
            expect(selectValues).toEqual(['P1']);

            // Standalone pool: exactly the idle candidates reset to Pending with results cleared.
            const [resetSql, resetValues] = callsOf('submissions', 'reset')[0];
            expect(resetSql).toContain('overall_status = $1');
            expect(resetSql).toContain('results = NULL');
            expect(resetSql).toContain('id = ANY($2::int[])');
            expect(resetValues).toEqual(['Pending', [1, 2]]);

            // Contest pool selected by the same problem id.
            expect(callsOf('contest_submissions', 'select')[0][1]).toEqual(['P1']);
            expect(callsOf('contest_submissions', 'reset')[0][1]).toEqual(['Pending', [7]]);

            // Every judgeable row goes through the existing judge queue.
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(3);
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledWith(expect.any(Function),
                { table: 'contest_submissions', submissionId: 7 }, 3);
            for (const task of queuedTasks) {
                await task();
            }
            expect(processSubmission).toHaveBeenCalledWith(1);
            expect(processSubmission).toHaveBeenCalledWith(2);
            expect(processContestSubmission).toHaveBeenCalledWith(7);
        });

        it('logs start and completion with counts', async () => {
            mockPools({ submissions: { candidates: [{ id: 1 }] } });

            await rejudgeProblem('P1');

            expect(logger.info).toHaveBeenCalledWith('rejudge started',
                expect.objectContaining({ scope: 'problem', problemId: 'P1' }));
            expect(logger.info).toHaveBeenCalledWith('rejudge completed',
                expect.objectContaining({ scope: 'problem', problemId: 'P1', queued: 1, skipped: 0 }));
        });

        it('warns (without blocking) when more than 500 rows are queued', async () => {
            mockPools({ submissions: { candidates: Array.from({ length: 501 }, (_, index) => ({ id: index + 1 })) } });

            const result = await rejudgeProblem('P1');

            expect(result.queued).toBe(501);
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(501);
            expect(logger.warn).toHaveBeenCalledWith('large rejudge batch queued',
                expect.objectContaining({ scope: 'problem', queued: 501 }));
        });

        it('does not warn for small batches', async () => {
            mockPools({ submissions: { candidates: [{ id: 1 }] } });

            await rejudgeProblem('P1');

            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('JUDGE-004: neither resets nor re-queues rows whose judge is still in flight (busy)', async () => {
            mockPools({ submissions: { candidates: [{ id: 1 }, { id: 2 }] } });
            // Row 1 is being judged right now (or has just written its verdict).
            (isSubmissionInFlight as jest.Mock).mockImplementation(
                (key: { table: string; submissionId: number }) =>
                    key.table === 'submissions' && key.submissionId === 1
            );

            const result = await rejudgeProblem('P1');

            expect(result).toEqual({ queued: 1, skipped: 0, busy: 1 });
            // The reset only names the idle row.
            expect(callsOf('submissions', 'reset')[0][1]).toEqual(['Pending', [2]]);
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(1);
            for (const task of queuedTasks) {
                await task();
            }
            expect(processSubmission).toHaveBeenCalledWith(2);
            expect(processSubmission).not.toHaveBeenCalledWith(1);
        });

        it('sends no reset at all when every candidate is in flight', async () => {
            mockPools({ submissions: { candidates: [{ id: 1 }] } });
            (isSubmissionInFlight as jest.Mock).mockImplementation(() => true);

            const result = await rejudgeProblem('P1');

            expect(result).toEqual({ queued: 0, skipped: 0, busy: 1 });
            expect(callsOf('submissions', 'reset')).toHaveLength(0);
            expect(enqueueTrackedJudgeTask).not.toHaveBeenCalled();
        });

        it('JUDGE-004: rejects a concurrent rejudge of the same problem with 409', async () => {
            (db.query as jest.Mock).mockImplementation(async () => ({ rows: [] }));

            // Hold the first rejudge open on its first DB call.
            let releaseFirst: () => void = () => {};
            const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
            (db.query as jest.Mock).mockImplementationOnce(async () => { await firstGate; return { rows: [] }; });

            const first = rejudgeProblem('P1');
            const second = rejudgeProblem('P1');

            await expect(second).rejects.toMatchObject({ statusCode: 409 });

            releaseFirst();
            await first;
        });
    });

    describe('rejudgeContest', () => {
        it('only touches contest_submissions scoped to the contest', async () => {
            mockPools({ contest_submissions: { candidates: [{ id: 5, contest_id: 9 }, { id: 6, contest_id: 9 }], skipped: 2 } });

            const result = await rejudgeContest(9);

            expect(result).toEqual({ queued: 2, skipped: 2, busy: 0 });

            // Candidates, one reset and one skip count; the standalone pool is never read.
            expect(db.query).toHaveBeenCalledTimes(3);
            const [selectSql, selectValues] = callsOf('contest_submissions', 'select')[0];
            const [resetSql, resetValues] = callsOf('contest_submissions', 'reset')[0];
            const [countSql, countValues] = callsOf('contest_submissions', 'count')[0];
            expect(selectSql).toContain('contest_id = $1');
            expect(selectValues).toEqual([9]);
            expect(resetValues).toEqual(['Pending', [5, 6]]);
            expect(countSql).toContain('contest_id = $1');
            expect(countValues).toEqual([9]);
            for (const sql of [selectSql, resetSql, countSql]) {
                expect(sql).not.toMatch(/(UPDATE|FROM) submissions\b/);
            }

            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(2);
            for (const task of queuedTasks) {
                await task();
            }
            expect(processContestSubmission).toHaveBeenCalledWith(5);
            expect(processContestSubmission).toHaveBeenCalledWith(6);
            expect(processSubmission).not.toHaveBeenCalled();
        });

        it('logs start and completion with the contest id', async () => {
            mockPools({ contest_submissions: { candidates: [{ id: 5, contest_id: 9 }] } });

            await rejudgeContest(9);

            expect(logger.info).toHaveBeenCalledWith('rejudge started',
                expect.objectContaining({ scope: 'contest', contestId: 9 }));
            expect(logger.info).toHaveBeenCalledWith('rejudge completed',
                expect.objectContaining({ scope: 'contest', contestId: 9, queued: 1, skipped: 0 }));
        });
    });
});
