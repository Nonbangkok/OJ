import * as db from '../../db';
import { isSubmissionInFlight, resetInFlightTracking } from '../../services/judgeQueue';
import { rejudgeContest, rejudgeProblem } from '../../services/rejudgeService';
import { processContestSubmission } from '../../services/submissionService';

// The real judge queue (and its in-flight registry); only the DB and the
// pipeline itself are stubbed.
jest.mock('../../db');
jest.mock('../../services/submissionService', () => ({
    processSubmission: jest.fn(),
    processContestSubmission: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/** Lets the judge queue's pump start whatever it was handed. */
const flushQueue = () => new Promise((resolve) => setImmediate(resolve));

/**
 * JUDGE-004: two rejudges with different scope keys (contest 1 and problem P1)
 * can both reach the same contest row. Each may see it idle before either has
 * queued it; the row must still be judged exactly once.
 */
describe('overlapping rejudges against the real judge queue', () => {
    let finishJudge: () => void = () => {};
    let releaseContestReset: () => void = () => {};

    beforeEach(() => {
        resetInFlightTracking();
        // The judge for row 7 keeps running until the test lets it finish.
        const judging = new Promise<void>((resolve) => { finishJudge = resolve; });
        (processContestSubmission as jest.Mock).mockImplementation(() => judging);
    });

    afterEach(async () => {
        finishJudge();
        releaseContestReset();
        await flushQueue();
        resetInFlightTracking();
    });

    it('a row queued by one rejudge while the other is resetting it is judged once', async () => {
        const contestResetGate = new Promise<void>((resolve) => { releaseContestReset = resolve; });
        let contestResetSent: () => void = () => {};
        const contestResetOnWire = new Promise<void>((resolve) => { contestResetSent = resolve; });
        let resets = 0;

        // One contest row (id 7, contest 1, problem P1); no standalone rows.
        (db.query as jest.Mock).mockImplementation(async (sql: string, values: unknown[]) => {
            const contestPool = sql.includes('contest_submissions');
            if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }] };
            if (!contestPool) return { rows: [] };
            if (sql.trimStart().startsWith('UPDATE')) {
                resets += 1;
                if (resets === 1) {
                    // The contest rejudge's reset is held on the wire.
                    contestResetSent();
                    await contestResetGate;
                }
                return { rows: (values[1] as number[]).map((id) => ({ id, contest_id: 1 })) };
            }
            return { rows: [{ id: 7, contest_id: 1 }] };
        });

        // Contest rejudge sees row 7 idle and sends its reset ...
        const contestRun = rejudgeContest(1);
        await contestResetOnWire;
        // ... meanwhile the problem rejudge also sees it idle, resets and queues it.
        const problemResult = await rejudgeProblem('P1');
        expect(problemResult).toEqual({ queued: 1, skipped: 0, busy: 0 });
        expect(isSubmissionInFlight({ table: 'contest_submissions', submissionId: 7 })).toBe(true);

        // The contest reset lands; by now row 7 has a judge, so it is not queued again.
        releaseContestReset();
        const contestResult = await contestRun;
        await flushQueue();

        expect(contestResult).toEqual({ queued: 0, skipped: 0, busy: 1 });
        expect((processContestSubmission as jest.Mock).mock.calls.filter(([id]) => id === 7)).toHaveLength(1);
    });
});
