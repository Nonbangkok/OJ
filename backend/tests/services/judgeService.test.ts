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
        // Wrapper argv layout: exe, then limits, then the sandbox uid, THEN
        // the runnable's args — none of them may leak into the child argv.
        expect(cmd).toMatch(/time_wrapper \/usr\/bin\/python3 \d+ \d+ \d+ \/tmp\/s\.py/);
    });

    it('kills a judge execution that outlives its limits (RUNNER-004 SIGKILL escalation)', async () => {
        jest.useFakeTimers();
        try {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });

            // A SIGTERM-ignoring sleeper: exec starts, the wall-clock limit
            // fires, and the escalation timer must SIGKILL the group.
            const killGroup = jest.fn();
            (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, opts, cb) => {
                const child = {
                    pid: 4242,
                    exitCode: null,
                    stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() },
                    on: jest.fn(),
                    kill: jest.fn(),
                };
                // The direct child never settles on its own (the sleeper ate
                // SIGTERM). Fire the process-group SIGKILL interception.
                const originalKill = process.kill.bind(process);
                (process.kill as unknown as jest.Mock) = killGroup.mockImplementation(
                    (pid, signal) => originalKill(pid, signal)
                );
                // Simulate the escalation path: after the grace period the
                // group kill fires, the shell dies, and exec reports TLE.
                setTimeout(() => {
                    const tleError = new Error('Command failed') as Error & { code: number };
                    tleError.code = JUDGE_CONFIG.TLE_EXIT_CODE;
                    cb(tleError, '', '');
                }, 10);
                return child;
            });

            const judgePromise = judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');
            // Advance past the exec timeout + kill grace: the escalation
            // timer must have fired the group SIGKILL by then.
            const deadline = 1000 + JUDGE_CONFIG.TIMEOUT_BUFFER_MS + JUDGE_CONFIG.KILL_GRACE_MS;
            await jest.advanceTimersByTimeAsync(deadline + 100);
            const result = await judgePromise;

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
            // The escalation SIGKILLed the whole process group.
            expect(killGroup).toHaveBeenCalledWith(-4242, 'SIGKILL');
        } finally {
            jest.useRealTimers();
        }
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

        // The `timeout` wall-clock and in-command limits use effective time,
        // with a SIGKILL grace after the limit (RUNNER-004).
        const effectiveTimeMs = 1000 * LANGUAGE_LIMITS.python.timeMultiplier;
        const killGraceS = Math.max(1, Math.ceil(JUDGE_CONFIG.KILL_GRACE_MS / 1000));
        expect(cmd).toContain(`timeout -k ${killGraceS}s ${effectiveTimeMs / 1000}s`);
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
        expect(cmd).toContain(`timeout -k ${Math.max(1, Math.ceil(JUDGE_CONFIG.KILL_GRACE_MS / 1000))}s 1s`);
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
            // JUDGE-002 evidence: the wrapper measured peak RSS over the
            // effective limit (python: 256MB * 2 = 512MB -> 600000KB used).
            const mleError = new Error('Command failed') as any;
            mleError.code = 1;
            cb(mleError, '', 'TIME_USED:0.100+0.020 MEM_USED:600000');
            return mockChild;
        });

        const result = await judge('P1', { command: '/usr/bin/python3', args: ['/tmp/s.py'] }, 'python');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
        // The REAL wrapper-measured figure is reported, not a fabricated
        // limit*1024 (JUDGE-002).
        expect(result.results[0].memoryKb).toBe(600000);
    });

    describe('verdict classification evidence (JUDGE-001/002/006/008)', () => {
        const setupProblem = () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ case_number: 1, input_data: '', output_data: '' }] });
        };

        const mockExecOnce = (impl: (cb: Function, child: unknown) => void) => {
            const mockChild = { stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() }, on: jest.fn() };
            (cp.exec as unknown as jest.Mock).mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
                impl(cb, mockChild);
                return mockChild;
            });
            return mockChild;
        };

        it('JUDGE-001: RE output contains no server paths, wrapper telemetry, or "Command failed" prefix', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // The exact leak shape from the audit: Node's Command failed
                // message carries the full wrapper invocation; the wrapper's
                // telemetry concatenates onto the program's unterminated
                // stderr line.
                const err = new Error(
                    'Command failed: timeout 1s ./scripts/time_wrapper /usr/src/app/dist/services/submissions/sub_265_1697...out 288 2'
                ) as Error & { code: number };
                err.code = 1;
                cb(err, '', 'bad stuffTIME_USED:0.050+0.010 MEM_USED:2880');
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
            const output = result.results[0].output ?? '';
            expect(output).not.toContain('Command failed');
            expect(output).not.toContain('/usr/src/app');
            expect(output).not.toContain('time_wrapper');
            expect(output).not.toContain('TIME_USED');
            expect(output).not.toContain('MEM_USED');
            // The program's own stderr survives sanitization.
            expect(output).toContain('bad stuff');
        });

        it('JUDGE-002: SIGSEGV with no memory evidence is a Runtime Error, not MLE', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // A wild-pointer crash: exit 128+11 (SIGSEGV) reported by the
                // wrapper, but peak RSS (1200KB) far below the 256MB limit.
                const err = new Error('Command failed') as Error & { code: number };
                err.code = 128 + 11; // SIGSEGV
                cb(err, '', 'TIME_USED:0.010+0.000 MEM_USED:1200');
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
        });

        it('JUDGE-002: a hard SIGKILL of the program is MLE with the real MEM_USED reported', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // OOM-style kill: wrapper reports the program died from
                // SIGKILL (exit 137) with the true peak RSS.
                const err = new Error('Command failed') as Error & { code: number };
                err.code = 128 + 9; // SIGKILL
                cb(err, '', 'TIME_USED:0.200+0.050 MEM_USED:400000');
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
            // The REAL measured figure, never the fabricated limit*1024.
            expect(result.results[0].memoryKb).toBe(400000);
        });

        it('JUDGE-002: a CLEAN exit with peak RSS over the effective limit is MLE (slack no longer masks it)', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // The program finished and exited 0, but measured peak RSS
                // (300MB) is over the 256MB effective limit — inside the
                // RLIMIT_AS slack, so the OS never killed it.
                cb(null, '', 'TIME_USED:0.100+0.020 MEM_USED:307200');
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
            expect(result.results[0].memoryKb).toBe(307200);
        });

        it('JUDGE-002: the old stderr "memory" substring heuristic no longer fabricates MLE', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // A program that merely PRINTS the word "memory" on stderr
                // and exits 1: must be a plain Runtime Error.
                const err = new Error('Command failed') as Error & { code: number };
                err.code = 1;
                cb(err, '', 'TIME_USED:0.010+0.000 MEM_USED:1200\nout of memory is a myth');
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
            expect(result.results[0].memoryKb).toBe(1200);
        });

        it('JUDGE-006: a clean-exiting program with a spurious stdin EPIPE gets its real verdict', async () => {
            setupProblem();
            const mockChild = mockExecOnce((cb) => {
                // Program exits 0 and never reads its large stdin — Node
                // fires an EPIPE error event on the stdin stream, but the
                // exec callback sees NO error.
                cb(null, '', '');
            });
            // Fire the spurious EPIPE BEFORE the callback resolves (the async
            // flag race from the audit finding).
            const stdinHandler = (mockChild.stdin.on as jest.Mock).mock.calls
                .find(([event]: [string]) => event === 'error')?.[1] as
                ((err: NodeJS.ErrnoException) => void) | undefined;
            stdinHandler?.(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            // Exit 0 with empty output vs empty expected: Accepted — the
            // program's REAL verdict, NOT the spurious Runtime Error.
            expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
        });

        it('JUDGE-008: a program that exits 124 itself is a Runtime Error, not TLE', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // Program called exit(124). Evidence against a real timeout:
                // the wrapper survived to print its telemetry line, and the
                // run finished well inside the 1000ms limit.
                const err = new Error('Command failed') as Error & { code: number };
                err.code = 124;
                cb(err, '', 'TIME_USED:0.010+0.000 MEM_USED:1200');
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
        });

        it('JUDGE-008: exit 124 with NO wrapper telemetry and past the limit is a real TLE', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // `timeout` SIGTERMed the wrapper at the wall-clock limit:
                // exit 124, no TIME_USED line, and the run took >= the limit.
                const err = new Error('Command failed') as Error & { code: number };
                err.code = 124;
                setTimeout(() => cb(err, '', ''), 1100);
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
        });

        it('JUDGE-008: the wrapper\'s RLIMIT_CPU backstop (SIGXCPU) is a TLE', async () => {
            setupProblem();
            mockExecOnce((cb) => {
                // Busy-loop killed by RLIMIT_CPU: the wrapper reports the
                // program died from SIGXCPU as exit 128+24.
                const err = new Error('Command failed') as Error & { code: number };
                err.code = 128 + 24; // SIGXCPU
                cb(err, '', 'TIME_USED:1.900+0.010 MEM_USED:1200');
            });

            const result = await judge('P1', { command: '/tmp/a.out', args: [] }, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
        });
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
