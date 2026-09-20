import { judge } from '../../services/judgeService';
import * as db from '../../db';
import cp from 'child_process';
import { SUBMISSION_STATUS, JUDGE_CONFIG, LANGUAGE_LIMITS } from '../../constants';

jest.mock('../../db');
jest.mock('child_process');

describe('Judge Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return system error if problem not found', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
    });

    it('should return system error if no testcases exist', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] }); // Problem
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // Testcases

        const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');
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

        const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

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

        const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

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

        const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
    });

    it('executes the provided runnable command via the time_wrapper path', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '1 2', output_data: '3' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
            cb(null, '3\n', '');
            return mockChild;
        });

        await judge('P1', { command: '/usr/bin/python3', args: ['/tmp/s.py'] }, 'python');

        expect(cp.exec).toHaveBeenCalledTimes(1);
        const cmd = (cp.exec as unknown as jest.Mock).mock.calls[0][0];
        expect(cmd).toContain('time_wrapper');
        // Wrapper argv layout: exe, then limits, THEN the runnable's args —
        // limits must never leak into the child program's argv.
        expect(cmd).toMatch(/time_wrapper \/usr\/bin\/python3 \d+ \d+ \/tmp\/s\.py/);
    });

    it('computes effective limits from the language multipliers (python: time x4, memory x2)', async () => {
        // Problem limits: 1000ms / 256MB. Python must be judged against
        // 4000ms / 512MB (the effective limits), not the raw C++ ones.
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
            cb(null, '', '');
            return mockChild;
        });

        const result = await judge('P1', { command: '/usr/bin/python3', args: ['/tmp/s.py'] }, 'python');

        const call = (cp.exec as unknown as jest.Mock).mock.calls[0];
        const [cmd, opts] = call;

        // The `timeout` wall-clock and in-command limits use effective time.
        const effectiveTimeMs = 1000 * LANGUAGE_LIMITS.python.timeMultiplier;
        expect(cmd).toContain(`timeout ${effectiveTimeMs / 1000}s`);
        // RLIMIT_AS = effective memory + slack; RLIMIT_CPU = ceil(effective seconds) + slack.
        const effectiveMemoryMb = 256 * LANGUAGE_LIMITS.python.memoryMultiplier;
        const expectedAsLimitMb = effectiveMemoryMb + JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB;
        const expectedCpuLimitS = Math.ceil(effectiveTimeMs / 1000) + JUDGE_CONFIG.CPU_LIMIT_SLACK_S;
        expect(cmd).toContain(`${expectedAsLimitMb} ${expectedCpuLimitS}`);
        // The exec wall-clock timeout also uses the effective time + buffer.
        expect(opts.timeout).toBe(effectiveTimeMs + JUDGE_CONFIG.TIMEOUT_BUFFER_MS);

        // The reported effective limits are exposed on the result.
        expect(result.timeLimitMs).toBe(effectiveTimeMs);
        expect(result.memoryLimitMb).toBe(effectiveMemoryMb);
    });

    it('keeps cpp limits identical when multipliers are 1x/1x', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
            cb(null, '', '');
            return mockChild;
        });

        const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

        const [cmd, opts] = (cp.exec as unknown as jest.Mock).mock.calls[0];
        expect(cmd).toContain('timeout 1s');
        expect(cmd).toContain(`${256 + JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB} ${1 + JUDGE_CONFIG.CPU_LIMIT_SLACK_S}`);
        expect(opts.timeout).toBe(1000 + JUDGE_CONFIG.TIMEOUT_BUFFER_MS);
        expect(result.timeLimitMs).toBe(1000);
        expect(result.memoryLimitMb).toBe(256);
    });

    it('reports a python TLE at the effective (4x) limit, not the raw problem limit', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
            const tleError = new Error('Command failed') as any;
            tleError.code = JUDGE_CONFIG.TLE_EXIT_CODE;
            cb(tleError, '', '');
            return mockChild;
        });

        const result = await judge('P1', { command: '/usr/bin/python3', args: ['/tmp/s.py'] }, 'python');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
        // A python TLE is reported against the python-scaled limit (4000ms).
        expect(result.results[0].timeMs).toBe(1000 * LANGUAGE_LIMITS.python.timeMultiplier);
    });

    it('caps a python Memory Limit Exceeded at the effective (2x) limit', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

        const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
        (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
            const mleError = new Error('Command failed') as any;
            mleError.signal = 'SIGSEGV';
            cb(mleError, '', 'MemoryError');
            return mockChild;
        });

        const result = await judge('P1', { command: '/usr/bin/python3', args: ['/tmp/s.py'] }, 'python');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
        expect(result.results[0].memoryKb).toBe(256 * LANGUAGE_LIMITS.python.memoryMultiplier * 1024);
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

        await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

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
