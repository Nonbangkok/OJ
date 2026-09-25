import {
    moveProblemsToContest,
    moveProblemsBackToMain,
    getAvailableProblemsForContest,
    migrateSubmissionsAfterContest
} from '../../services/problemMigration';
import * as db from '../../db';
import { publishRealtime } from '../../services/realtimeHub';

jest.mock('../../services/realtimeHub', () => ({
    publishRealtime: jest.fn(),
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
                expect.stringContaining('is_visible_before_contest = is_visible'),
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
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // check contest
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
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // check contest
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
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce(undefined); // COMMIT

            await moveProblemsBackToMain(1);

            const updateSql = String((mockClient.query as jest.Mock).mock.calls[2][0]);
            // Visibility is restored from the snapshot, not hardcoded TRUE.
            expect(updateSql).not.toContain('is_visible = TRUE');
            // Legacy rows without a snapshot keep the old (visible) behavior.
            expect(updateSql).toContain('COALESCE(is_visible_before_contest, TRUE)');
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
    });
});
