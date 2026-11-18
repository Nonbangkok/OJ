import {
    moveProblemsToContest,
    moveProblemsBackToMain,
    getAvailableProblemsForContest,
    migrateSubmissionsAfterContest
} from '../../services/problemMigration';
import * as db from '../../db';
import { publishRealtime } from '../../services/realtimeHub';
import { enqueueTrackedJudgeTask, waitForContestJudgesToDrain } from '../../services/judgeQueue';
import { processSubmission } from '../../services/submissionService';
import { JUDGE_CONFIG } from '../../constants';

jest.mock('../../services/realtimeHub', () => ({
    publishRealtime: jest.fn(),
}));
jest.mock('../../services/judgeQueue', () => ({
    waitForContestJudgesToDrain: jest.fn().mockResolvedValue(true),
    getContestInFlightCount: jest.fn(() => 0),
    enqueueTrackedJudgeTask: jest.fn(),
}));
jest.mock('../../services/submissionService', () => ({
    processSubmission: jest.fn(),
}));

// Mock db.pool.connect
const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
};

jest.mock('../../db', () => ({
    pool: {
        connect: jest.fn(() => mockClient),
    },
    query: jest.fn(),
}));

describe('Problem Migration Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.error = jest.fn(); // Suppress expected errors
    });

    describe('moveProblemsToContest', () => {
        it('should successfully move problems to a contest', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status: 'scheduled' }] }) // check contest
                .mockResolvedValueOnce({ rows: [{ id: 'P1', contest_id: null }] }) // check problems
                .mockResolvedValueOnce({ rows: [{ id: 'P1', title: 'Problem 1' }] }) // UPDATE
                .mockResolvedValueOnce(undefined); // COMMIT

            const result = await moveProblemsToContest(1, ['P1']);

            expect(result.success).toBe(true);
            expect(result.movedProblems).toHaveLength(1);
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should snapshot pre-contest visibility when moving to a contest (XSYS-004)', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status: 'scheduled' }] })
                .mockResolvedValueOnce({ rows: [{ id: 'P1', contest_id: null }] })
                .mockResolvedValueOnce({ rows: [{ id: 'P1', title: 'Problem 1' }] })
                .mockResolvedValueOnce(undefined); // COMMIT

            await moveProblemsToContest(1, ['P1']);

            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('is_visible_before_contest = p.is_visible'),
                [1, ['P1']],
            );
        });

        it('should throw and rollback if contest not found', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [] }) // check contest (empty)
                .mockResolvedValueOnce(undefined); // ROLLBACK

            await expect(moveProblemsToContest(99, ['P1'])).rejects.toThrow('Contest not found');
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should throw and rollback if problem is already in a contest', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status: 'scheduled' }] }) // contest valid
                .mockResolvedValueOnce({ rows: [{ id: 'P1', contest_id: 2 }] }) // problem in another contest
                .mockResolvedValueOnce(undefined); // ROLLBACK

            await expect(moveProblemsToContest(1, ['P1'])).rejects.toThrow('Problems already in contest');
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        });
    });

    describe('moveProblemsBackToMain', () => {
        it('should successfully move specific problems back to main', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status: 'running', ended: false }] }) // check contest
                .mockResolvedValueOnce({ rows: [{ id: 'P1' }] }) // UPDATE
                .mockResolvedValueOnce(undefined); // COMMIT

            const result = await moveProblemsBackToMain(1, ['P1']);

            expect(result.success).toBe(true);
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('is_visible = COALESCE(is_visible_before_contest, TRUE)'),
                [1, ['P1']]
            );
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        });

        it('should move all problems if no specific problemIds are provided', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status: 'running', ended: false }] }) // check contest
                .mockResolvedValueOnce({ rows: [{ id: 'P1' }, { id: 'P2' }] }) // UPDATE
                .mockResolvedValueOnce(undefined); // COMMIT

            const result = await moveProblemsBackToMain(1); // null/undefined problemIds

            expect(result.success).toBe(true);
            expect(result.movedProblems).toHaveLength(2);
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('is_visible_before_contest = NULL'),
                [1]
            );
        });

        it('bulk move-back no longer force-publishes hidden problems (XSYS-004/CONTEST-006)', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status: 'running', ended: false }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce(undefined); // COMMIT

            await moveProblemsBackToMain(1);

            const updateSql = String((mockClient.query as jest.Mock).mock.calls[2][0]);
            // Visibility is restored from the snapshot, not hardcoded TRUE.
            expect(updateSql).not.toContain('is_visible = TRUE');
            // Legacy rows without a snapshot keep the old (visible) behavior.
            expect(updateSql).toContain('COALESCE(is_visible_before_contest, TRUE)');
        });

        it('locks the contest row, so the scheduler cannot end the contest mid-move', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status: 'running', ended: false }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce(undefined); // COMMIT

            await moveProblemsBackToMain(1, ['P1']);

            const lookupSql = String((mockClient.query as jest.Mock).mock.calls[1][0]);
            expect(lookupSql).toMatch(/FROM contests WHERE id = \$1 FOR UPDATE/);
        });

        it.each([
            ['finishing', true],
            ['finished', true],
            ['running', true], // past its end time, the scheduler has not flipped it yet
        ])('refuses a %s contest (ended: %s) with 409 and moves nothing', async (status, ended) => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, status, ended }] })
                .mockResolvedValueOnce(undefined); // ROLLBACK

            await expect(moveProblemsBackToMain(1, ['P1'])).rejects.toMatchObject({
                statusCode: 409,
                message: expect.stringMatching(/before the contest ends/i),
            });
            const statements = (mockClient.query as jest.Mock).mock.calls.map(([text]) => String(text));
            expect(statements.some((t) => t.includes('SET contest_id = NULL'))).toBe(false);
            expect(statements).toContain('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('answers 404 for an unknown contest', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce(undefined); // ROLLBACK

            await expect(moveProblemsBackToMain(99, ['P1'])).rejects.toMatchObject({ statusCode: 404, message: 'Contest not found' });
        });

        it("inside the finish migration's transaction it trusts the caller's status check", async () => {
            (mockClient.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'P1' }] }); // UPDATE

            const result = await moveProblemsBackToMain(1, null, mockClient as never);

            expect(result.movedProblems).toHaveLength(1);
            const statements = (mockClient.query as jest.Mock).mock.calls.map(([text]) => String(text));
            expect(statements).toHaveLength(1);
            expect(statements[0]).toContain('SET contest_id = NULL');
            expect(db.pool.connect).not.toHaveBeenCalled();
            expect(mockClient.release).not.toHaveBeenCalled();
        });
    });

    describe('getAvailableProblemsForContest', () => {
        it('should return problems where contest_id is null', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'P1' }, { id: 'P2' }] });

            const problems = await getAvailableProblemsForContest();

            expect(problems).toHaveLength(2);
            expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE contest_id IS NULL'));
        });
    });

    describe('migrateSubmissionsAfterContest', () => {
        it('JUDGE-005: drains in-flight contest judges BEFORE the migration deletes their rows', async () => {
            (waitForContestJudgesToDrain as jest.Mock).mockResolvedValueOnce(true);
            const queryOrder: string[] = [];
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                queryOrder.push(String(text).slice(0, 40));
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                return { rows: [] };
            });

            await migrateSubmissionsAfterContest(1);

            // The drain completed before a pool client (transaction) was taken.
            expect(waitForContestJudgesToDrain).toHaveBeenCalledWith(1, expect.any(Number));
            expect(queryOrder.length).toBeGreaterThan(0);
            const drainOrder = (waitForContestJudgesToDrain as jest.Mock).mock.invocationCallOrder[0];
            const connectOrder = (db.pool.connect as jest.Mock).mock.invocationCallOrder[0];
            expect(drainOrder).toBeLessThan(connectOrder);
        });

        it('waits the full drain timeout by default and the given one when told to', async () => {
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                return { rows: [] };
            });

            await migrateSubmissionsAfterContest(1);
            expect(waitForContestJudgesToDrain).toHaveBeenLastCalledWith(1, JUDGE_CONFIG.CONTEST_MIGRATION_DRAIN_TIMEOUT_MS);

            await migrateSubmissionsAfterContest(1, { drainTimeoutMs: 1234 });
            expect(waitForContestJudgesToDrain).toHaveBeenLastCalledWith(1, 1234);
        });

        it('A5-02: defers without writing anything when the drain times out with judges still in flight', async () => {
            (waitForContestJudgesToDrain as jest.Mock).mockResolvedValueOnce(false);

            const result = await migrateSubmissionsAfterContest(1);

            expect(result).toMatchObject({ success: false, deferred: true, migratedSubmissions: 0 });
            expect(db.pool.connect).not.toHaveBeenCalled();
            expect(mockClient.query).not.toHaveBeenCalled();
            expect(publishRealtime).not.toHaveBeenCalled();
        });

        it('A5-02: when told to finish with judges in flight, re-judges every migrated row that has no verdict yet', async () => {
            (waitForContestJudgesToDrain as jest.Mock).mockResolvedValueOnce(false);
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                if (String(text).includes('INSERT INTO submissions')) {
                    return { rows: [{ id: 10, overall_status: 'Pending' }, { id: 11, overall_status: 'Accepted' }, { id: 12, overall_status: 'Pending' }] };
                }
                return { rows: [] };
            });

            const result = await migrateSubmissionsAfterContest(1, { proceedWithJudgesInFlight: true });

            expect(result.success).toBe(true);
            expect(result.deferred).toBeUndefined();
            // Rows caught mid-judge are copied as Pending so they are re-judged.
            const insertCall = (mockClient.query as jest.Mock).mock.calls
                .find(([text]) => String(text).includes('INSERT INTO submissions')) as [string, unknown[]];
            expect(insertCall[0]).toContain('CASE WHEN overall_status IN ($2, $3) THEN $4 ELSE overall_status END');
            expect(insertCall[1]).toEqual([1, 'Compiling', 'Running', 'Pending']);
            // Enqueued only after COMMIT, one tracked practice-pool judge per unjudged row.
            expect(enqueueTrackedJudgeTask).toHaveBeenCalledTimes(2);
            expect((enqueueTrackedJudgeTask as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
                { table: 'submissions', submissionId: 10 },
                { table: 'submissions', submissionId: 12 },
            ]);
            const commitOrder = (mockClient.query as jest.Mock).mock.invocationCallOrder[
                (mockClient.query as jest.Mock).mock.calls.findIndex(([text]) => text === 'COMMIT')
            ];
            expect(commitOrder).toBeLessThan((enqueueTrackedJudgeTask as jest.Mock).mock.invocationCallOrder[0]);
            await (enqueueTrackedJudgeTask as jest.Mock).mock.calls[0][0]();
            expect(processSubmission).toHaveBeenCalledWith(10);
        });

        it('moves the problems back inside the migration transaction (one client, one COMMIT)', async () => {
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                return { rows: [] };
            });

            await migrateSubmissionsAfterContest(1);

            expect(db.pool.connect).toHaveBeenCalledTimes(1);
            const statements = (mockClient.query as jest.Mock).mock.calls.map(([text]) => String(text));
            expect(statements.filter((t) => t === 'BEGIN')).toHaveLength(1);
            expect(statements.filter((t) => t === 'COMMIT')).toHaveLength(1);
            const moveBack = statements.findIndex((t) => t.includes('SET contest_id = NULL'));
            expect(moveBack).toBeGreaterThan(-1);
            expect(moveBack).toBeLessThan(statements.indexOf('COMMIT'));
            expect(enqueueTrackedJudgeTask).not.toHaveBeenCalled();
        });

        it('should publish a scoreboard_update after the final scoreboard is written', async () => {
            // All client queries succeed; the scoreboard INSERT returns one row.
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                if (String(text).includes('INSERT INTO contest_scoreboards')) {
                    return { rows: [{ user_id: 1 }] };
                }
                if (String(text).includes('INSERT INTO submissions')) {
                    return { rows: [{ id: 10 }] };
                }
                return { rows: [] };
            });

            const result = await migrateSubmissionsAfterContest(1);

            expect(result.success).toBe(true);
            expect(publishRealtime).toHaveBeenCalledWith({ type: 'scoreboard_update', contestId: 1 });
        });

        it('awards XP for migrated Accepted solves inside the transaction (SCORE-002/DB-03)', async () => {
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                if (String(text).includes('INSERT INTO submissions')) {
                    return { rows: [{ id: 10 }] };
                }
                return { rows: [] };
            });

            await migrateSubmissionsAfterContest(1);

            const awardCall = (mockClient.query as jest.Mock).mock.calls
                .map((c: unknown[]) => c)
                .find(([text]) => String(text).includes('INSERT INTO user_problem_rewards'));
            expect(awardCall).toBeDefined();
            const [awardSql, awardParams] = awardCall as [string, unknown[]];
            // Idempotent: same conflict target as awardSolveReward.
            expect(awardSql).toContain('ON CONFLICT (user_id, problem_id) DO NOTHING');
            // Mirrors the live judge pipeline: Accepted at a full score only.
            expect(awardSql).toContain('overall_status = $2');
            expect(awardSql).toContain('score >= $3');
            expect(awardParams).toEqual([1, 'Accepted', 100]);
        });

        it('should not publish when the migration rolls back', async () => {
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'running' }] }; // wrong status → throws
                }
                return { rows: [] };
            });

            await expect(migrateSubmissionsAfterContest(1)).rejects.toThrow('finishing');

            expect(publishRealtime).not.toHaveBeenCalled();
        });

        it('snapshots every participant, zero-scored included (CONTEST-007)', async () => {
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                if (String(text).includes('INSERT INTO submissions')) {
                    return { rows: [{ id: 10 }] };
                }
                return { rows: [] };
            });

            await migrateSubmissionsAfterContest(1);

            const scoreboardCall = (mockClient.query as jest.Mock).mock.calls
                .map((c: unknown[]) => c)
                .find(([text]) => String(text).includes('INSERT INTO contest_scoreboards'));
            expect(scoreboardCall).toBeDefined();
            const [sql] = scoreboardCall as [string, unknown[]];
            // The driver table is contest_participants (LEFT JOIN scores), so
            // participants with no submissions still get a scoreboard row.
            expect(sql).toContain('FROM contest_participants cp');
            expect(sql).toContain('LEFT JOIN user_totals ut');
            expect(sql).toContain('COALESCE(ut.total_score, 0)');
            expect(sql).not.toContain('JOIN contest_participants cp ON cp.user_id = uts.user_id');
        });

        it('writes detailed_scores in the live scoreboard shape (CONTEST-008)', async () => {
            (mockClient.query as jest.Mock).mockImplementation(async (text: string) => {
                if (String(text).includes('SELECT id, status FROM contests')) {
                    return { rows: [{ id: 1, status: 'finishing' }] };
                }
                if (String(text).includes('INSERT INTO submissions')) {
                    return { rows: [{ id: 10 }] };
                }
                return { rows: [] };
            });

            await migrateSubmissionsAfterContest(1);

            const scoreboardCall = (mockClient.query as jest.Mock).mock.calls
                .map((c: unknown[]) => c)
                .find(([text]) => String(text).includes('INSERT INTO contest_scoreboards'));
            const [sql] = scoreboardCall as [string, unknown[]];
            // {problemId: {score}} — same shape the live scoreboard serves.
            expect(sql).toMatch(/jsonb_object_agg\(pb\.problem_id, jsonb_build_object\(\s*'score', pb\.best_score/);
            expect(sql).not.toContain('jsonb_object_agg(pb.problem_id, pb.best_score)');
        });
    });
});
