import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { judge, formatRuntimeErrorOutput } from '../../services/judgeService';
import * as db from '../../db';
import cp from 'child_process';
import { SUBMISSION_STATUS, JUDGE_CONFIG, LANGUAGE_LIMITS } from '../../constants';
import { normalizeOutput, outputsMatch } from '../../utils/outputComparison';
import { canDropPrivileges, killSandboxProcesses } from '../../utils/sandboxProcess';

jest.mock('../../db');
jest.mock('child_process');
// The per-uid sweep needs a root backend; CI runs this suite as root inside
// the backend image, so the decision is pinned here and tests opt in.
jest.mock('../../utils/sandboxProcess', () => ({
    canDropPrivileges: jest.fn(() => false),
    killSandboxProcesses: jest.fn(async () => undefined),
    nextSandboxIdentity: jest.fn(() => ({ uid: 60000, gid: 60000 })),
}));


describe('output comparison normalization (trailing whitespace per line)', () => {
    describe('normalizeOutput', () => {
        it('strips trailing spaces/tabs per line', () => {
            expect(normalizeOutput('2 3 4 \n1 5 6 \n')).toBe('2 3 4\n1 5 6');
            expect(normalizeOutput('a\t\nb   \n')).toBe('a\nb');
        });

        it('preserves leading whitespace per line', () => {
            expect(normalizeOutput('a\n b')).toBe('a\n b');
            expect(normalizeOutput('  abc')).toBe('abc'); // outer-leading still trimmed (existing semantics)
        });

        it('preserves internal whitespace', () => {
            expect(normalizeOutput('1  2')).toBe('1  2');
        });

        it('normalizes CRLF line endings (lone CR is not a line separator, matching the original comparator)', () => {
            expect(normalizeOutput('a\r\nb\r\n')).toBe('a\nb');
            expect(normalizeOutput('a \r\nb')).toBe('a\nb');
            // Lone CR was never a line break in the original comparator; keep it.
            expect(normalizeOutput('a\rb')).toBe('a\rb');
        });

        it('handles empty and whitespace-only output', () => {
            expect(normalizeOutput('')).toBe('');
            expect(normalizeOutput('   \n\t\n')).toBe('');
            expect(normalizeOutput('  ')).toBe('');
        });

        it('keeps whitespace-only lines in the middle (structural blank lines)', () => {
            // A blank line between content survives normalization as a line
            // (the whitespace itself is dropped, but the line break stays).
            expect(normalizeOutput('a\n \nb')).toBe('a\n\nb');
        });
    });

    describe('outputsMatch — MUST ACCEPT', () => {
        it.each([
            ['trailing space before newline (the TUSCO SetOperator bug)', '2 3 4 \n1 5 6 \n', '2 3 4\n1 5 6\n'],
            ['trailing tab and trailing spaces on separate lines', 'a\t\nb   \n', 'a\nb\n'],
            ['outer trailing newline (existing outer semantics)', 'hello\n', 'hello'],
            ['both sides have trailing whitespace', '2 3 4 \n1 5 6 ', '2 3 4\n1 5 6\n'],
            ['CRLF actual vs LF expected', 'a\r\nb\r\n', 'a\nb\n'],
            ['empty vs empty', '', ''],
            ['empty vs whitespace-only', ' \n\t\n', ''],
            ['multiple lines, no trailing whitespace anywhere', '1 2 3\n4 5 6\n7 8 9\n', '1 2 3\n4 5 6\n7 8 9\n'],
        ])('%s', (_label, actual, expected) => {
            expect(outputsMatch(actual, expected)).toBe(true);
            expect(outputsMatch(expected, actual)).toBe(true); // symmetric
        });
    });

    describe('outputsMatch — MUST REJECT', () => {
        it.each([
            ['internal double space', '1  2', '1 2'],
            ['leading space on a middle line', 'a\n b', 'a\nb'],
            ['different numbers', '123', '124'],
            ['missing line', 'a\nb', 'a'],
            ['extra line', 'a', 'a\nb'],
            ['token order', '1 2', '2 1'],
            ['structural blank line difference', 'a\n\nb', 'a\nb'],
            ['tab inside a line vs space', '1\t2', '1 2'],
        ])('%s', (_label, actual, expected) => {
            expect(outputsMatch(actual, expected)).toBe(false);
        });
    });
});


/** What one fake `timeout ... time_wrapper` run produces. */
interface FakeRun {
    stdout?: string;
    stderr?: string | Buffer | Buffer[];
    /** What the wrapper writes on its telemetry fd (3). */
    telemetry?: string;
    code?: number | null;
    signal?: NodeJS.Signals | null;
    /** Delay before the run ends (ms). */
    delayMs?: number;
    /** Never end on its own (the escalation test ends it). */
    hang?: boolean;
    /** Exit, but keep the stdio pipes open (an orphan still holds them). */
    holdPipes?: boolean;
}

interface FakeChild extends EventEmitter {
    pid: number;
    stdin: { write: jest.Mock; end: jest.Mock; on: jest.Mock };
    stdout: PassThrough;
    stderr: PassThrough;
    stdio: unknown[];
    finish: (code: number | null, signal: NodeJS.Signals | null) => void;
}

const fakeChild = (run: FakeRun): FakeChild => {
    const child = new EventEmitter() as FakeChild;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const telemetry = new PassThrough();
    const stdin = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
    Object.assign(child, { pid: 4242, stdin, stdout, stderr, stdio: [stdin, stdout, stderr, telemetry] });
    child.finish = (code, signal) => {
        if (run.stdout) stdout.write(run.stdout);
        for (const chunk of [run.stderr ?? []].flat()) stderr.write(chunk);
        if (run.telemetry) telemetry.write(run.telemetry);
        child.emit('exit', code, signal);
        if (run.holdPipes) return;
        stdout.end();
        stderr.end();
        telemetry.end();
        setImmediate(() => child.emit('close', code, signal));
    };
    if (!run.hang) setTimeout(() => child.finish(run.code ?? 0, run.signal ?? null), run.delayMs ?? 0);
    return child;
};

const spawnMock = cp.spawn as unknown as jest.Mock;

/** Queue the next spawned run. */
const mockRunOnce = (run: FakeRun = {}): void => {
    spawnMock.mockImplementationOnce(() => fakeChild(run));
};

/** Wrapper telemetry line for `kb` peak RSS. */
const telemetryLine = (kb: number, cpu = '0.010+0.000'): string => `TIME_USED:${cpu} MEM_USED:${kb}\n`;

const mockProblem = (cases: Array<{ input?: string; output?: string }> = [{}], limits = { time_limit_ms: 1000, memory_limit_mb: 256 }) => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [limits] });
    (db.query as jest.Mock).mockResolvedValueOnce({
        rows: cases.map((c, i) => ({ case_number: i + 1, input_data: c.input ?? '', output_data: c.output ?? '' })),
    });
};

const cpp = { command: '/tmp/a.out', args: [] as string[] };
const python = { command: '/usr/bin/python3', args: ['/tmp/s.py'] };

describe('Judge Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (canDropPrivileges as jest.Mock).mockReturnValue(false);
        (killSandboxProcesses as jest.Mock).mockResolvedValue(undefined);
    });

    it('should return system error if problem not found', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const result = await judge('P1', cpp, 'cpp');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
    });

    it('should return system error if no testcases exist', async () => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ time_limit_ms: 1000, memory_limit_mb: 256 }] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const result = await judge('P1', cpp, 'cpp');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
    });

    it('should judge an Accepted submission correctly', async () => {
        mockProblem([{ input: '1 2', output: '3' }, { input: '2 3', output: '5' }]);
        mockRunOnce({ stdout: '3\n', telemetry: telemetryLine(1200) });
        mockRunOnce({ stdout: '5\n', telemetry: telemetryLine(1300) });

        const result = await judge('P1', cpp, 'cpp');

        expect(result.score).toBe(100);
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
        expect(result.results.map((r) => r.status)).toEqual([SUBMISSION_STATUS.ACCEPTED, SUBMISSION_STATUS.ACCEPTED]);
        expect(result.maxMemoryKb).toBe(1300);
    });

    it('should correctly handle Wrong Answer', async () => {
        mockProblem([{ input: '1 2', output: '3' }, { input: '2 3', output: '5' }]);
        mockRunOnce({ stdout: 'wrong\n', telemetry: telemetryLine(1200) });

        const result = await judge('P1', cpp, 'cpp');

        expect(result.score).toBe(0);
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.WRONG_ANSWER);
        // Since it breaks early, the second case is skipped
        expect(result.results[0].status).toBe(SUBMISSION_STATUS.WRONG_ANSWER);
        expect(result.results[1].status).toBe(SUBMISSION_STATUS.SKIPPED);
    });

    it('should correctly parse TLE', async () => {
        mockProblem();
        // `timeout` killed the wrapper at the limit: exit 124, no telemetry.
        mockRunOnce({ code: JUDGE_CONFIG.TLE_EXIT_CODE });

        const result = await judge('P1', cpp, 'cpp');
        expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
    });

    it('spawns timeout + time_wrapper without a shell, with a telemetry pipe (A4-04)', async () => {
        mockProblem([{ input: '1 2', output: '3' }]);
        mockRunOnce({ stdout: '3\n' });

        await judge('P1', python, 'python');

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [command, args, opts] = spawnMock.mock.calls[0];
        expect(command).toBe('timeout');
        // Wrapper argv layout: exe, then limits, then the sandbox uid, THEN
        // the runnable's args — none of them may leak into the child argv.
        const wrapperAt = args.indexOf(JUDGE_CONFIG.TIME_WRAPPER_PATH);
        expect(wrapperAt).toBeGreaterThan(0);
        expect(args.slice(wrapperAt + 1)).toEqual(['/usr/bin/python3', expect.stringMatching(/^\d+$/), expect.stringMatching(/^\d+$/), '60000', '/tmp/s.py']);
        expect(opts.shell).toBeUndefined();
        expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe', 'pipe']);
        expect(opts.detached).toBe(true);
    });

    it('kills a judge execution that outlives its limits (RUNNER-004 SIGKILL escalation)', async () => {
        jest.useFakeTimers();
        const killSpy = jest.spyOn(process, 'kill');
        try {
            mockProblem();
            // `timeout` itself wedges: only the Node-side escalation ends it.
            let child: FakeChild | undefined;
            spawnMock.mockImplementationOnce(() => {
                child = fakeChild({ hang: true });
                return child;
            });
            killSpy.mockImplementation(((pid: number, signal?: string | number) => {
                if (pid === -4242 && signal === 'SIGKILL') child?.finish(null, 'SIGKILL');
                return true;
            }) as typeof process.kill);

            const judgePromise = judge('P1', cpp, 'cpp');
            const deadline = 1000 + JUDGE_CONFIG.TIMEOUT_BUFFER_MS + JUDGE_CONFIG.KILL_GRACE_MS;
            await jest.advanceTimersByTimeAsync(deadline + 100);
            const result = await judgePromise;

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
            // The escalation SIGKILLed the whole process group.
            expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
        } finally {
            killSpy.mockRestore();
            jest.useRealTimers();
        }
    });

    it('computes effective limits from the language multipliers (python: time x4, memory x2)', async () => {
        // Problem limits: 1000ms / 256MB. Python must be judged against
        // 4000ms / 512MB (the effective limits), not the raw C++ ones.
        mockProblem();
        mockRunOnce();

        const result = await judge('P1', python, 'python');

        const [, args] = spawnMock.mock.calls[0];
        const effectiveTimeMs = 1000 * LANGUAGE_LIMITS.python.timeMultiplier;
        const killGraceS = Math.max(1, Math.ceil(JUDGE_CONFIG.KILL_GRACE_MS / 1000));
        // The `timeout` wall clock uses the effective time, with a SIGKILL
        // grace after the limit (RUNNER-004).
        expect(args.slice(0, 3)).toEqual(['-k', `${killGraceS}s`, `${effectiveTimeMs / 1000}s`]);
        // RLIMIT_AS = effective memory + slack; RLIMIT_CPU = ceil(effective seconds) + slack.
        const effectiveMemoryMb = 256 * LANGUAGE_LIMITS.python.memoryMultiplier;
        const wrapperAt = args.indexOf(JUDGE_CONFIG.TIME_WRAPPER_PATH);
        expect(args[wrapperAt + 2]).toBe(String(effectiveMemoryMb + JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB));
        expect(args[wrapperAt + 3]).toBe(String(Math.ceil(effectiveTimeMs / 1000) + JUDGE_CONFIG.CPU_LIMIT_SLACK_S));

        expect(result.timeLimitMs).toBe(effectiveTimeMs);
        expect(result.memoryLimitMb).toBe(effectiveMemoryMb);
    });

    it('keeps cpp limits identical when multipliers are 1x/1x', async () => {
        mockProblem();
        mockRunOnce();

        const result = await judge('P1', cpp, 'cpp');

        const [, args] = spawnMock.mock.calls[0];
        expect(args.slice(0, 3)).toEqual(['-k', `${Math.max(1, Math.ceil(JUDGE_CONFIG.KILL_GRACE_MS / 1000))}s`, '1s']);
        const wrapperAt = args.indexOf(JUDGE_CONFIG.TIME_WRAPPER_PATH);
        expect(args.slice(wrapperAt + 2, wrapperAt + 4)).toEqual([
            String(256 + JUDGE_CONFIG.MEMORY_LIMIT_SLACK_MB),
            String(1 + JUDGE_CONFIG.CPU_LIMIT_SLACK_S),
        ]);
        expect(result.timeLimitMs).toBe(1000);
        expect(result.memoryLimitMb).toBe(256);
    });

    it('reports a python TLE at the effective (4x) limit, not the raw problem limit', async () => {
        mockProblem();
        mockRunOnce({ code: JUDGE_CONFIG.TLE_EXIT_CODE });

        const result = await judge('P1', python, 'python');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
        expect(result.results[0].timeMs).toBe(1000 * LANGUAGE_LIMITS.python.timeMultiplier);
    });

    it('caps a python Memory Limit Exceeded at the effective (2x) limit', async () => {
        mockProblem();
        // JUDGE-002 evidence: the wrapper measured peak RSS over the
        // effective limit (python: 256MB * 2 = 512MB -> 600000KB used).
        mockRunOnce({ code: 1, telemetry: telemetryLine(600000, '0.100+0.020') });

        const result = await judge('P1', python, 'python');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
        // The REAL wrapper-measured figure (JUDGE-002).
        expect(result.results[0].memoryKb).toBe(600000);
    });

    describe('verdict classification evidence (JUDGE-001/002/006/008, A4-04)', () => {
        it('JUDGE-001: RE output keeps the program stderr minus telemetry look-alikes and server paths', async () => {
            mockProblem();
            mockRunOnce({
                code: 1,
                stderr: 'bad stuffTIME_USED:0.050+0.010 MEM_USED:2880 at /tmp/oj-submissions/sub_9_1_abc/solution.out',
                telemetry: telemetryLine(2880),
            });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
            const output = result.results[0].output ?? '';
            expect(output).not.toContain('TIME_USED');
            expect(output).not.toContain('MEM_USED');
            expect(output).not.toContain('oj-submissions');
            expect(output).toContain('bad stuff');
            expect(output).toContain('solution.out');
        });

        it('A4-04: telemetry the program prints on stderr is ignored; only the wrapper fd counts', async () => {
            mockProblem();
            mockRunOnce({
                code: 0,
                stderr: telemetryLine(1, '0.001+0.000'),
                telemetry: telemetryLine(307200, '0.400+0.020'),
            });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
            expect(result.results[0].memoryKb).toBe(307200);
        });

        it('A4-04: a forged stderr line cannot stand in for a missing wrapper report', async () => {
            mockProblem();
            // The wrapper was killed at the limit (exit 124, nothing on fd 3)
            // while the program printed a fake report: still a timeout.
            mockRunOnce({ code: JUDGE_CONFIG.TLE_EXIT_CODE, stderr: telemetryLine(1, '0.001+0.000') });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
        });

        it('JUDGE-002: SIGSEGV with no memory evidence is a Runtime Error, not MLE', async () => {
            mockProblem();
            mockRunOnce({ code: 128 + 11, telemetry: telemetryLine(1200) });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
            // No stderr: the neutral description names the signal.
            expect(result.results[0].output).toBe('Program terminated by signal SIGSEGV');
        });

        it('JUDGE-002: a hard SIGKILL of the program is MLE with the real MEM_USED reported', async () => {
            mockProblem();
            mockRunOnce({ code: 128 + 9, telemetry: telemetryLine(400000, '0.200+0.050') });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
            expect(result.results[0].memoryKb).toBe(400000);
        });

        it('JUDGE-002: a CLEAN exit with peak RSS over the effective limit is MLE (slack no longer masks it)', async () => {
            mockProblem();
            mockRunOnce({ code: 0, telemetry: telemetryLine(307200, '0.100+0.020') });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.MEMORY_LIMIT_EXCEEDED);
            expect(result.results[0].memoryKb).toBe(307200);
        });

        it('JUDGE-002: the old stderr "memory" substring heuristic no longer fabricates MLE', async () => {
            mockProblem();
            mockRunOnce({ code: 1, stderr: 'out of memory is a myth', telemetry: telemetryLine(1200) });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
            expect(result.results[0].memoryKb).toBe(1200);
        });

        it('JUDGE-006: a clean-exiting program with a spurious stdin EPIPE gets its real verdict', async () => {
            mockProblem();
            let child: FakeChild | undefined;
            spawnMock.mockImplementationOnce(() => {
                child = fakeChild({ code: 0, telemetry: telemetryLine(1200), delayMs: 5 });
                return child;
            });

            const judgePromise = judge('P1', cpp, 'cpp');
            await new Promise((resolve) => setImmediate(resolve));
            const stdinHandler = child!.stdin.on.mock.calls
                .find(([event]: [string]) => event === 'error')?.[1] as ((err: NodeJS.ErrnoException) => void) | undefined;
            stdinHandler?.(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
            const result = await judgePromise;

            // Exit 0 with empty output vs empty expected: Accepted.
            expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
        });

        it('JUDGE-008: a program that exits 124 itself is a Runtime Error, not TLE', async () => {
            mockProblem();
            // The wrapper survived to report, well inside the limit.
            mockRunOnce({ code: 124, telemetry: telemetryLine(1200) });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
        });

        it('JUDGE-008: exit 124 with NO wrapper telemetry and past the limit is a real TLE', async () => {
            mockProblem();
            mockRunOnce({ code: 124, delayMs: 1100 });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
        });

        it('JUDGE-008: the wrapper\'s RLIMIT_CPU backstop (SIGXCPU) is a TLE', async () => {
            mockProblem();
            mockRunOnce({ code: 128 + 24, telemetry: telemetryLine(1200, '1.900+0.010') });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.TIME_LIMIT_EXCEEDED);
        });
    });

    describe('Runtime Error output (A9-04 / A4-08)', () => {
        it('keeps at most RUN_STDERR_MAX_BYTES of stderr and stores a capped head with a truncation marker', async () => {
            mockProblem();
            const chunk = Buffer.alloc(64 * 1024, 'x');
            mockRunOnce({ code: 1, stderr: [Buffer.from('HEAD\n'), ...Array.from({ length: 16 }, () => chunk)], telemetry: telemetryLine(1200) });

            const result = await judge('P1', cpp, 'cpp');

            const output = result.results[0].output ?? '';
            expect(output.startsWith('HEAD\n')).toBe(true);
            expect(Buffer.byteLength(output)).toBeLessThanOrEqual(JUDGE_CONFIG.RUNTIME_ERROR_OUTPUT_MAX_BYTES);
            // Everything the program wrote is accounted for, kept or drained.
            const omitted = Number(/\[truncated (\d+) bytes\]$/.exec(output)?.[1]);
            expect(omitted).toBe(5 + 16 * 64 * 1024 - Buffer.byteLength(output.replace(/\n\[truncated \d+ bytes\]$/, '')));
        });

        it('header problems store only a neutral crash description, never program stderr', async () => {
            mockProblem();
            mockRunOnce({ code: 128 + 6, stderr: 'GRADER_SECRET dumped from memory', telemetry: telemetryLine(1200) });

            const result = await judge('P1', cpp, 'cpp', { hideProgramStderr: true });

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
            expect(result.results[0].output).toBe('Program terminated by signal SIGABRT');
        });

        it('replaces the workspace path in a traceback with the bare file name', async () => {
            mockProblem();
            const workspaceDir = '/tmp/oj-submissions/sub_7_1_AbC123';
            mockRunOnce({
                code: 1,
                stderr: `Traceback (most recent call last):\n  File "${workspaceDir}/solution.py", line 1, in <module>\nValueError: boom\n`,
                telemetry: telemetryLine(9000),
            });

            const result = await judge('P1', python, 'python', { workspaceDir });

            expect(result.results[0].output).toBe('Traceback (most recent call last):\n  File "solution.py", line 1, in <module>\nValueError: boom');
        });

        it('a stdout flood past EXEC_MAX_BUFFER is killed and reported as a Runtime Error', async () => {
            const config = JUDGE_CONFIG as { EXEC_MAX_BUFFER: number };
            const original = config.EXEC_MAX_BUFFER;
            config.EXEC_MAX_BUFFER = 1024;
            const killSpy = jest.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);
            try {
                mockProblem();
                mockRunOnce({ code: null, signal: 'SIGKILL', stdout: 'y'.repeat(4096), telemetry: telemetryLine(1200) });

                const result = await judge('P1', cpp, 'cpp');

                expect(result.overallStatus).toBe(SUBMISSION_STATUS.RUNTIME_ERROR);
                expect(result.results[0].output).toBe('Output limit exceeded');
                expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
            } finally {
                config.EXEC_MAX_BUFFER = original;
                killSpy.mockRestore();
            }
        });
    });

    describe('sandbox hygiene (A4-02 / A9-05)', () => {
        it('runs the program with its workspace as TMPDIR', async () => {
            mockProblem();
            mockRunOnce();

            await judge('P1', cpp, 'cpp', { workspaceDir: '/tmp/oj-submissions/sub_1_1_ws' });

            const [, , opts] = spawnMock.mock.calls[0];
            expect(opts.env).toEqual({ PATH: JUDGE_CONFIG.SANDBOX_PATH, TMPDIR: '/tmp/oj-submissions/sub_1_1_ws' });
        });

        it('kills the identity\'s processes after every testcase when it can drop privileges', async () => {
            (canDropPrivileges as jest.Mock).mockReturnValue(true);
            mockProblem([{ output: '1' }, { output: '2' }]);
            mockRunOnce({ stdout: '1\n' });
            mockRunOnce({ stdout: '2\n' });
            const sandbox = { uid: 60007, gid: 60007 };

            const result = await judge('P1', cpp, 'cpp', { sandbox });

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
            expect(killSandboxProcesses).toHaveBeenCalledTimes(2);
            expect(killSandboxProcesses).toHaveBeenCalledWith(sandbox);
        });

        it('a testcase whose leftovers cannot be killed fails the submission closed (System Error)', async () => {
            (canDropPrivileges as jest.Mock).mockReturnValue(true);
            (killSandboxProcesses as jest.Mock).mockRejectedValueOnce(new Error('processes survived'));
            mockProblem([{ output: '1' }, { output: '2' }]);
            mockRunOnce({ stdout: '1\n' });

            const result = await judge('P1', cpp, 'cpp', { sandbox: { uid: 60007, gid: 60007 } });

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
            expect(result.score).toBe(0);
            expect(spawnMock).toHaveBeenCalledTimes(1);
        });

        it('settles even when something keeps the stdio pipes open after the run exits', async () => {
            mockProblem([{ output: '7' }]);
            mockRunOnce({ stdout: '7\n', holdPipes: true });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
        });

        it('a run that cannot start is a System Error, not a verdict', async () => {
            mockProblem();
            spawnMock.mockImplementationOnce(() => {
                const child = fakeChild({ hang: true });
                (child as unknown as { pid: undefined }).pid = undefined;
                setImmediate(() => child.emit('error', Object.assign(new Error('spawn timeout ENOENT'), { code: 'ENOENT' })));
                return child;
            });

            const result = await judge('P1', cpp, 'cpp');

            expect(result.overallStatus).toBe(SUBMISSION_STATUS.SYSTEM_ERROR);
        });
    });

    it('accepts a solution whose output has trailing spaces before newlines (the SetOperator WA)', async () => {
        mockProblem([{ input: 'x', output: '2 3 4\n1 5 6\n' }]);
        mockRunOnce({ stdout: '2 3 4 \n1 5 6 \n' });

        const result = await judge('P1', cpp, 'cpp');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
        expect(result.score).toBe(100);
    });

    it('accepts trailing tabs and CRLF actual output vs LF expected', async () => {
        mockProblem([{ input: 'x', output: 'a\nb\n' }]);
        mockRunOnce({ stdout: 'a\t\r\nb   \r\n' });

        const result = await judge('P1', cpp, 'cpp');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.ACCEPTED);
    });

    it('still rejects leading whitespace on a middle line', async () => {
        mockProblem([{ input: 'x', output: 'a\nb\n' }]);
        mockRunOnce({ stdout: 'a\n b\n' });

        const result = await judge('P1', cpp, 'cpp');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.WRONG_ANSWER);
    });

    it('still rejects internal double spaces', async () => {
        mockProblem([{ input: 'x', output: '1 2' }]);
        mockRunOnce({ stdout: '1  2\n' });

        const result = await judge('P1', cpp, 'cpp');

        expect(result.overallStatus).toBe(SUBMISSION_STATUS.WRONG_ANSWER);
    });

    it('strips secrets from the executed program environment (sandbox env-strip)', async () => {
        // Plant secrets on the judge process environment; submitted code must NOT
        // be able to read these via getenv().
        process.env.SECRET_KEY = 'super-secret-session-key';
        process.env.PGPASSWORD = 'db-password';
        process.env.DATABASE_URL = 'postgres://user:pw@database:5432/oj';
        mockProblem();
        mockRunOnce();

        await judge('P1', cpp, 'cpp');

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const opts = spawnMock.mock.calls[0][2];
        // The child must receive a minimal, locked-down environment.
        expect(opts.env.PATH).toBe(JUDGE_CONFIG.SANDBOX_PATH);
        expect(opts.env.SECRET_KEY).toBeUndefined();
        expect(opts.env.PGPASSWORD).toBeUndefined();
        expect(opts.env.DATABASE_URL).toBeUndefined();
    });
});

describe('formatRuntimeErrorOutput (A9-04)', () => {
    const cap = JUDGE_CONFIG.RUNTIME_ERROR_OUTPUT_MAX_BYTES;

    it('returns short stderr unchanged apart from trimming', () => {
        expect(formatRuntimeErrorOutput(Buffer.from('  boom\n'))).toBe('boom');
    });

    it('drops NUL bytes, which a jsonb results column cannot store', () => {
        expect(formatRuntimeErrorOutput(Buffer.from('a\u0000b'))).toBe('ab');
    });

    it('removes the workspace directory and any other submissions path', () => {
        const workspaceDir = '/tmp/oj-submissions/sub_1_2_XyZ';
        const text = `${workspaceDir}/solution.out: solution.cpp:5: main: Assertion failed\ncwd ${workspaceDir}\n/private/tmp/oj-submissions/other_9/solution.py`;
        expect(formatRuntimeErrorOutput(Buffer.from(text), { workspaceDir }))
            .toBe('solution.out: solution.cpp:5: main: Assertion failed\ncwd workspace\nsolution.py');
    });

    it('caps the text, marks the cut and counts what was dropped', () => {
        const output = formatRuntimeErrorOutput(Buffer.alloc(10_000, 'z'), { totalBytes: 50_000 });
        expect(Buffer.byteLength(output)).toBeLessThanOrEqual(cap);
        const [, kept, omitted] = /^(z+)\n\[truncated (\d+) bytes\]$/.exec(output) ?? [];
        expect(kept.length + Number(omitted)).toBe(50_000);
    });

    it('marks bytes that were drained without being kept even when the kept part is short', () => {
        expect(formatRuntimeErrorOutput(Buffer.from('head'), { totalBytes: 100 })).toBe('head\n[truncated 96 bytes]');
    });

    it('never splits a multi-byte UTF-8 character', () => {
        const output = formatRuntimeErrorOutput(Buffer.from('ก'.repeat(5000)));
        const head = output.replace(/\n\[truncated \d+ bytes\]$/, '');
        expect(head).toMatch(/^ก+$/);
        expect(Buffer.byteLength(output)).toBeLessThanOrEqual(cap);
    });
});
