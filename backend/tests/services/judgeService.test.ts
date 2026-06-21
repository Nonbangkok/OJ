import { judge } from '../../services/judgeService';
import * as db from '../../db';
import cp from 'child_process';
import { SUBMISSION_STATUS, JUDGE_CONFIG } from '../../constants';

jest.mock('../../db');
jest.mock('child_process');

describe('Judge Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return system error if problem not found', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const result = await judge('P1', '/tmp/a.out');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
    });

    it('should return system error if no testcases exist', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] }); // Problem
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // Testcases

        const result = await judge('P1', '/tmp/a.out');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
    });

    it('should judge an Accepted submission correctly', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({
            rows: [
                { case_number: 1, input_data: '1 2', output_data: '3' },
                { case_number: 2, input_data: '2 3', output_data: '5' }
            ]
        });

        // Mock child process exec to succeed for both test cases
        const mockChild1 = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        const mockChild2 = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };

        (cp.exec as unknown as jest.Mock)
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
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({
            rows: [
                { case_number: 1, input_data: '1 2', output_data: '3' },
                { case_number: 2, input_data: '2 3', output_data: '5' } // This won't be run if case 1 fails immediately
            ]
        });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };

        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
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
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };

        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
            const tleError = new Error('Command failed') as any;
            tleError.code = 124; // Timeout exit code
            cb(tleError, '', '');
            return mockChild;
        });

        const result = await judge('P1', '/tmp/a.out');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
    });

    it('strips secrets from the executed program environment (sandbox env-strip)', async () => {
        // Plant secrets on the judge process environment; submitted code must NOT
        // be able to read these via getenv().
        process.env.SECRET_KEY = 'super-secret-session-key';
        process.env.PGPASSWORD = 'db-password';
        process.env.DATABASE_URL = 'postgres://user:pw@database:5432/oj';

        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
            cb(null, '', '');
            return mockChild;
        });

        await judge('P1', '/tmp/a.out');

        expect(cp.exec).toHaveBeenCalledTimes(1);
        const opts = (cp.exec as unknown as jest.Mock).mock.calls[0][1];
        // The child must receive a minimal, locked-down environment.
        expect(opts.env).toBeDefined();
        expect(opts.env.PATH).toBe(JUDGE_CONFIG.SANDBOX_PATH);
        expect(opts.env.SECRET_KEY).toBeUndefined();
        expect(opts.env.PGPASSWORD).toBeUndefined();
        expect(opts.env.DATABASE_URL).toBeUndefined();
    });
});
