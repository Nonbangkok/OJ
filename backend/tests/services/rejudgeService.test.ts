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

describe('Rejudge Service', () => {
    let queuedTasks: JudgeTask[];

    beforeEach(() => {
        queuedTasks = [];
        (enqueueTrackedJudgeTask as jest.Mock).mockImplementation((task: JudgeTask) => {
            queuedTasks.push(task);
        });
    });

    describe('rejudgeProblem', () => {
        it('resets and enqueues judgeable rows from both pools, counting empty-code rows as skipped', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // UPDATE submissions RETURNING
                .mockResolvedValueOnce({ rows: [{ count: 1 }] })         // skipped count, submissions
                .mockResolvedValueOnce({ rows: [{ id: 7 }] })            // UPDATE contest_submissions RETURNING
                .mockResolvedValueOnce({ rows: [{ count: 0 }] });        // skipped count, contest_submissions

            const result = await rejudgeProblem('P1');

            expect(result).toEqual({ queued: 3, skipped: 1, busy: 0 });

            // Standalone pool: judgeable rows reset to Pending with results cleared.
            expect(db.query).toHaveBeenNthCalledWith(1,
                expect.stringContaining('UPDATE submissions'),
                ['Pending', 'P1']);
            const resetSql = (db.query as jest.Mock).mock.calls[0][0] as string;
            expect(resetSql).toContain('overall_status = $1');
            expect(resetSql).toContain('results = NULL');
            expect(resetSql).toContain('problem_id = $2');
            expect(resetSql).toContain("COALESCE(code, '') <> ''");

            // Contest pool selected by the same problem id.
            expect(db.query).toHaveBeenNthCalledWith(3,
                expect.stringContaining('UPDATE contest_submissions'),
                ['Pending', 'P1']);

            // Every judgeable row goes through the existing judge queue.
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(3);
            for (const task of queuedTasks) {
                await task();
            }
            expect(processSubmission).toHaveBeenCalledWith(1);
            expect(processSubmission).toHaveBeenCalledWith(2);
            expect(processContestSubmission).toHaveBeenCalledWith(7);
        });

        it('logs start and completion with counts', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] });

            await rejudgeProblem('P1');

            expect(logger.info).toHaveBeenCalledWith('rejudge started',
                expect.objectContaining({ scope: 'problem', problemId: 'P1' }));
            expect(logger.info).toHaveBeenCalledWith('rejudge completed',
                expect.objectContaining({ scope: 'problem', problemId: 'P1', queued: 1, skipped: 0 }));
        });

        it('warns (without blocking) when more than 500 rows are queued', async () => {
            const manyRows = Array.from({ length: 501 }, (_, index) => ({ id: index + 1 }));
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: manyRows })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] });

            const result = await rejudgeProblem('P1');

            expect(result.queued).toBe(501);
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(501);
            expect(logger.warn).toHaveBeenCalledWith('large rejudge batch queued',
                expect.objectContaining({ scope: 'problem', queued: 501 }));
        });

        it('does not warn for small batches', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] });

            await rejudgeProblem('P1');

            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('JUDGE-004: skips rows whose judge is already in flight (busy), never double-queuing them', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 1, contest_id: null }, { id: 2, contest_id: null }] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] });
            // Row 1 is being judged right now.
            (isSubmissionInFlight as jest.Mock).mockImplementation(
                (key: { table: string; submissionId: number }) =>
                    key.table === 'submissions' && key.submissionId === 1
            );

            const result = await rejudgeProblem('P1');

            expect(result).toEqual({ queued: 1, skipped: 0, busy: 1 });
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(1);
            for (const task of queuedTasks) {
                await task();
            }
            // Only the NOT-in-flight row is dispatched.
            expect(processSubmission).toHaveBeenCalledWith(2);
            expect(processSubmission).not.toHaveBeenCalledWith(1);
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
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 5 }, { id: 6 }] }) // UPDATE contest_submissions RETURNING
                .mockResolvedValueOnce({ rows: [{ count: 2 }] });         // skipped count

            const result = await rejudgeContest(9);

            expect(result).toEqual({ queued: 2, skipped: 2, busy: 0 });

            // Exactly one reset + one skip count; the standalone pool is never read.
            expect(db.query).toHaveBeenCalledTimes(2);
            expect(db.query).toHaveBeenNthCalledWith(1,
                expect.stringContaining('UPDATE contest_submissions'),
                ['Pending', 9]);
            expect(db.query).toHaveBeenNthCalledWith(2,
                expect.stringContaining('FROM contest_submissions'),
                [9]);

            const updateSql = (db.query as jest.Mock).mock.calls[0][0] as string;
            const countSql = (db.query as jest.Mock).mock.calls[1][0] as string;
            expect(updateSql).toContain('contest_id = $2');
            expect(countSql).toContain('contest_id = $1');
            expect(updateSql).not.toContain('UPDATE submissions');
            expect(countSql).not.toContain('FROM submissions');

            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(2);
            for (const task of queuedTasks) {
                await task();
            }
            expect(processContestSubmission).toHaveBeenCalledWith(5);
            expect(processContestSubmission).toHaveBeenCalledWith(6);
            expect(processSubmission).not.toHaveBeenCalled();
        });

        it('logs start and completion with the contest id', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 5 }] })
                .mockResolvedValueOnce({ rows: [{ count: 0 }] });

            await rejudgeContest(9);

            expect(logger.info).toHaveBeenCalledWith('rejudge started',
                expect.objectContaining({ scope: 'contest', contestId: 9 }));
            expect(logger.info).toHaveBeenCalledWith('rejudge completed',
                expect.objectContaining({ scope: 'contest', contestId: 9, queued: 1, skipped: 0 }));
        });
    });
});
