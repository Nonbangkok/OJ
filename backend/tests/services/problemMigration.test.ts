import {
    moveProblemsToContest,
    moveProblemsBackToMain,
    getAvailableProblemsForContest
} from '../../services/problemMigration';
import * as db from '../../db';

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
                expect.stringContaining('UPDATE problems SET contest_id = NULL, is_visible = TRUE WHERE contest_id = $1 AND id = ANY($2)'),
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
                expect.stringContaining('UPDATE problems SET contest_id = NULL, is_visible = TRUE WHERE contest_id = $1 RETURNING id, title'),
                [1]
            );
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
});
