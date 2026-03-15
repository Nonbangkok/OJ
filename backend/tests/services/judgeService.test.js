const { judge } = require('../../services/judgeService');
const db = require('../../db');
const cp = require('child_process');
const { SUBMISSION_STATUS } = require('../../constants');

jest.mock('../../db');
jest.mock('child_process');

describe('Judge Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return system error if problem not found', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });

        const result = await judge('P1', '/tmp/a.out');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
    });

    it('should return system error if no testcases exist', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] }); // Problem
        db.query.mockResolvedValueOnce({ rows: [] }); // Testcases

        const result = await judge('P1', '/tmp/a.out');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
    });

    it('should judge an Accepted submission correctly', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        db.query.mockResolvedValueOnce({
            rows: [
                { case_number: 1, input_data: '1 2', output_data: '3' },
                { case_number: 2, input_data: '2 3', output_data: '5' }
            ]
        });

        // Mock child process exec to succeed for both test cases
        const mockChild1 = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        const mockChild2 = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };

        cp.exec
            .mockImplementationOnce((cmd, opts, cb) => {
                cb(null, '3\n', ''); // stdout, stderr
                return mockChild1;
            })
            .mockImplementationOnce((cmd, opts, cb) => {
                cb(null, '5\n', ''); // stdout, stderr
                return mockChild2;
            });

        const result = await judge('P1', '/tmp/a.out');

        expect(result.score).toBe(100);
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
        expect(result.results).toHaveLength(2);
        expect(result.results[0].status).toBe(SUBMISSION_STATUS.ACCEPTED);
        expect(result.results[1].status).toBe(SUBMISSION_STATUS.ACCEPTED);
    });

    it('should correctly handle Wrong Answer', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        db.query.mockResolvedValueOnce({
            rows: [
                { case_number: 1, input_data: '1 2', output_data: '3' },
                { case_number: 2, input_data: '2 3', output_data: '5' } // This won't be run if case 1 fails immediately
            ]
        });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };

        cp.exec.mockImplementationOnce((cmd, opts, cb) => {
            cb(null, 'wrong\n', ''); // Output doesn't match
            return mockChild;
        });

        const result = await judge('P1', '/tmp/a.out');

        expect(result.score).toBe(0); // Failed first case
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.WRONG_ANSWER);
        // Since it breaks early, the second case is skipped
        expect(result.results[0].status).toBe(SUBMISSION_STATUS.WRONG_ANSWER);
        expect(result.results[1].status).toBe(SUBMISSION_STATUS.SKIPPED);
    });

    it('should correctly parse TLE', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        db.query.mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };

        cp.exec.mockImplementationOnce((cmd, opts, cb) => {
            const tleError = new Error('Command failed');
            tleError.code = 124; // Timeout exit code
            cb(tleError, '', '');
            return mockChild;
        });

        const result = await judge('P1', '/tmp/a.out');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
    });
});
