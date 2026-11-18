import { processSubmission, processContestSubmission, sweepOrphanedSubmissions } from '../../services/submissionService';
import * as db from '../../db';
import fs from 'fs';
import path from 'path';
import cp from 'child_process';
import { judge } from '../../services/judgeService';
import { publishRealtime } from '../../services/realtimeHub';
import { awardSolveReward } from '../../services/progressionService';
import { enqueueTrackedJudgeTask } from '../../services/judgeQueue';
import { getHeaderJudgeSpec } from '../../services/problemFilesService';
import { JUDGE_CONFIG } from '../../constants';

jest.mock('../../db');
// The header-problem spec is read through its own service (own db.query
// calls); mocking it keeps this suite's positional db.query mocks intact and
// lets each test declare the problem type it exercises.
jest.mock('../../services/problemFilesService', () => ({
    getHeaderJudgeSpec: jest.fn(),
}));
jest.mock('../../services/realtimeHub', () => ({
    publishRealtime: jest.fn(),
}));
jest.mock('../../services/judgeQueue', () => ({
    enqueueTrackedJudgeTask: jest.fn(),
}));
jest.mock('../../services/progressionService', () => ({
    awardSolveReward: jest.fn(),
}));
jest.mock('fs', () => ({
    existsSync: jest.fn(() => true),
    // The pipeline resolves the real OS tmpdir for the submissions root.
    tmpdir: jest.fn(() => '/tmp'),
    realpathSync: jest.fn(() => '/tmp'),
    mkdirSync: jest.fn(),
    unlink: jest.fn((path, cb) => cb && cb(null)),
    rm: jest.fn((path, opts, cb) => cb && cb(null)),
    promises: {
        writeFile: jest.fn(),
        chmod: jest.fn(),
        chown: jest.fn(),
        mkdir: jest.fn(),
        rm: jest.fn(),
        // The submissions root is ours (ensureSandboxSubmissionsRoot checks).
        lstat: jest.fn(async () => ({ isDirectory: () => true, uid: process.getuid?.() ?? 0 })),
        // No shared scratch dir holds anything the sandbox uid left behind.
        opendir: jest.fn(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
        // mkdtemp yields a workspace directory; tests assert on its usage.
        mkdtemp: jest.fn(async (prefix: string) => `${prefix}XXXXXX`),
    }
}));
jest.mock('child_process', () => {
    // runBoundedChildProcess subscribes to stdout/stderr data and the close
    // event; emit an empty-data close asynchronously so the compile settles.
    const spawn = jest.fn((command: string, args: string[], options: unknown) => {
        const handlers: Record<string, (...a: unknown[]) => void> = {};
        const child = {
            pid: 1111,
            stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
            stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
            on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
            kill: jest.fn(),
        };
        setImmediate(() => {
            handlers.stdout?.(Buffer.from(''));
            handlers.stderr?.(Buffer.from(''));
            handlers.close?.(0, null);
        });
        return child;
    });
    return { spawn };
});
jest.mock('../../services/judgeService');

/**
 * A benign spawn stub (empty output, exit 0; `mktemp` reports a workspace) —
 * mirrors the child_process module mock's default so a describe that
 * overrides `cp.spawn` with its own implementation can put it back and not
 * leak compile behaviour into the next describe.
 */
const benignSpawn = (command: string) => {
    const handlers: Record<string, (...a: unknown[]) => void> = {};
    const child = {
        pid: 1111,
        stdin: { on: jest.fn(), end: jest.fn() },
        stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
        stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
        on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
        kill: jest.fn(),
    };
    setImmediate(() => {
        if (command === 'mktemp') handlers.stdout?.(Buffer.from('/tmp/oj-submissions/sub_1_1_testws\n'));
        handlers.stdout?.(Buffer.from(''));
        handlers.stderr?.(Buffer.from(''));
        handlers.close?.(0, null);
    });
    return child;
};

/** The Compilation Error output the pipeline persisted (results JSON). */
const compilationErrorOutput = (callIndex: number): string =>
    JSON.parse((db.query as jest.Mock).mock.calls[callIndex][1][0])[0].output;

describe('Submission Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: a solve earns nothing new (reward already existed).
        (awardSolveReward as jest.Mock).mockResolvedValue(0);
        // Default: an ordinary standard problem (the header tests override).
        (getHeaderJudgeSpec as jest.Mock).mockResolvedValue({
            problemType: 'standard', submissionFilename: null, graderFiles: [],
        });
        console.error = jest.fn(); // Suppress expected errors in tests
        // Default to the unprivileged dev path regardless of who runs the
        // suite (CI runs it as root inside the backend image, where the real
        // check returns true). Privileged-path tests override this to true.
        jest.spyOn(jest.requireActual('../../utils/sandboxProcess'), 'canDropPrivileges').mockReturnValue(false);
    });

    describe('processSubmission', () => {
        it('should handle missing submission gracefully', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // Not found

            await processSubmission(1);

            expect(db.query).toHaveBeenCalledWith('SELECT * FROM submissions WHERE id = $1', [1]);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
            expect(fs.promises.writeFile).not.toHaveBeenCalled();
        });

        it('should update status to Compiling and run g++ successfully', async () => {
            // Mock db queries: 1. SELECT, 2. UPDATE Compiling, 3. UPDATE Running, 4. UPDATE Results
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'int main(){}', language: 'cpp' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });

            await processSubmission(1);

            // Verify DB interactions
            expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE submissions SET overall_status = \'Compiling\''), [1]);
            expect(fs.promises.writeFile).toHaveBeenCalled();

            // Verify compilation ran as a bounded, shell-less child process
            // (RUNNER-001/RUNNER-005). The wall-clock/output caps are applied
            // inside runBoundedChildProcess (unit-tested in
            // tests/utils/sandboxProcess.test.ts); here we verify the spawn
            // itself: no shell, relative source paths only, prlimit caps
            // wrapping g++, and a secret-free environment.
            expect(cp.spawn).toHaveBeenCalledTimes(1);
            const [compileCmd, compileArgs, compileOpts] = (cp.spawn as unknown as jest.Mock).mock.calls[0];
            // When prlimit is available (existsSync is mocked true here) the
            // compile is wrapped: prlimit <caps> -- g++ <flags>.
            expect(compileArgs).toContain('--');
            const gccIndex = compileArgs.indexOf('--') + 1;
            expect(compileArgs[gccIndex]).toContain('g++');
            expect(compileArgs).toEqual(expect.arrayContaining(['-std=c++20', '-fsanitize=signed-integer-overflow', '-fno-sanitize-recover=signed-integer-overflow']));
            expect(compileArgs).not.toContain(expect.stringContaining('/tmp')); // no absolute server paths in argv
            expect(compileCmd).toBe(JUDGE_CONFIG.PRLIMIT_PATH);
            // prlimit caps mirror the authoring compiler recipe (RUNNER-005).
            expect(compileArgs).toContain(`--as=${JUDGE_CONFIG.COMPILE_AS_LIMIT_BYTES}`);
            expect(compileArgs).toContain(`--nproc=${JUDGE_CONFIG.COMPILE_NPROC_LIMIT}`);
            expect(compileArgs).toContain(`--fsize=${JUDGE_CONFIG.COMPILE_FSIZE_LIMIT_BYTES}`);
            expect(compileArgs).toContain('--core=0');
            expect(compileOpts.shell).toBeUndefined();
            expect(compileOpts.env.PATH).toBe(JUDGE_CONFIG.SANDBOX_PATH);
            expect(compileOpts.env.DATABASE_URL).toBeUndefined();
            expect(compileOpts.env.PGPASSWORD).toBeUndefined();
            expect(compileOpts.env.SECRET_KEY).toBeUndefined();

            // Verify Running status updated
            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE submissions SET overall_status = \'Running\''), [1]);

            // Verify judge was called with the compiled binary runnable and language
            expect(judge).toHaveBeenCalledWith('P1', { command: expect.stringContaining('.out'), args: [] }, 'cpp', expect.anything());

            // Verify final results saved
            expect(db.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE submissions\n       SET overall_status'), ['Accepted', 100, JSON.stringify([{ testCase: 1, status: 'Accepted' }]), 10, 2048, 1]);
        });

        it('should handle compilation errors correctly', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'bad code', language: 'cpp' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE final status

            // Make the bounded compile process exit non-zero (g++ syntax error).
            (cp.spawn as unknown as jest.Mock).mockImplementationOnce(() => {
                const handlers: Record<string, (...a: unknown[]) => void> = {};
                const child = {
                    pid: 1111,
                    stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
                    stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
                    on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
                    kill: jest.fn(),
                };
                setImmediate(() => {
                    handlers.stderr?.(Buffer.from('error: expected ;'));
                    handlers.close?.(1, null);
                });
                return child;
            });

            await processSubmission(1);

            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE submissions SET overall_status = \'Compilation Error\''), [expect.any(String), 1]);
            expect(judge).not.toHaveBeenCalled();
        });
    });

    describe('processContestSubmission', () => {
        it('should correctly process a basic contest submission', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'int main(){}', language: 'cpp' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });

            await processContestSubmission(1);

            expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE contest_submissions SET overall_status = \'Compiling\''), [1]);
            expect(db.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE contest_submissions\n       SET overall_status'), ['Accepted', 100, JSON.stringify([{ testCase: 1, status: 'Accepted' }]), 10, 2048, 1]);
        });
    });

    describe('realtime emissions', () => {
        it('publishes the full status sequence for a regular submission', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });

            await processSubmission(1);

            // Every status transition publishes a realtime event after the
            // DB write succeeds.
            expect(publishRealtime).toHaveBeenCalledTimes(3);
            expect(publishRealtime).toHaveBeenNthCalledWith(1, {
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'Compiling',
                score: 0,
                user_id: 42,
            });
            expect(publishRealtime).toHaveBeenNthCalledWith(2, {
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'Running',
                score: 0,
                user_id: 42,
            });
            expect(publishRealtime).toHaveBeenNthCalledWith(3, {
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 42,
            });
        });

        it('publishes Compilation Error (no further events) when the compile fails', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'bad code', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE Compilation Error

            // Make the bounded compile process exit non-zero (syntax error).
            (cp.spawn as unknown as jest.Mock).mockImplementationOnce(() => {
                const handlers: Record<string, (...a: unknown[]) => void> = {};
                const child = {
                    pid: 1111,
                    stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
                    stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
                    on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
                    kill: jest.fn(),
                };
                setImmediate(() => {
                    handlers.stderr?.(Buffer.from('syntax error'));
                    handlers.close?.(1, null);
                });
                return child;
            });

            await processSubmission(1);

            expect(publishRealtime).toHaveBeenCalledTimes(2);
            expect(publishRealtime).toHaveBeenNthCalledWith(2, {
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'Compilation Error',
                score: 0,
                user_id: 42,
            });
        });

        it('publishes a scoreboard_update when a contest submission reaches its final verdict', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', contest_id: 9, user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });

            await processContestSubmission(1);

            // Compiling, Running, final submission_update, then the scoreboard ping.
            expect(publishRealtime).toHaveBeenCalledTimes(4);
            expect(publishRealtime).toHaveBeenNthCalledWith(3, {
                type: 'submission_update',
                submissionId: 1,
                table: 'contest_submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 42,
            });
            expect(publishRealtime).toHaveBeenNthCalledWith(4, {
                type: 'scoreboard_update',
                contestId: 9,
            });
        });

        it('attaches xp_awarded to the Accepted event when a new first-solve reward is created', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });
            (awardSolveReward as jest.Mock).mockResolvedValueOnce(46);

            await processSubmission(1);

            expect(awardSolveReward).toHaveBeenCalledWith(42, 'P1');
            expect(publishRealtime).toHaveBeenLastCalledWith({
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 42,
                xp_awarded: 46,
            });
        });

        it('omits xp_awarded when the Accepted solve was already rewarded', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });
            (awardSolveReward as jest.Mock).mockResolvedValueOnce(0); // re-solve: nothing new

            await processSubmission(1);

            expect(publishRealtime).toHaveBeenLastCalledWith({
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 42,
            });
        });

        it('omits xp_awarded when the reward lookup fails (reward is not part of the verdict)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });
            (awardSolveReward as jest.Mock).mockRejectedValueOnce(new Error('rewards table gone'));

            await processSubmission(1);

            expect(publishRealtime).toHaveBeenLastCalledWith({
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'Accepted',
                score: 100,
                user_id: 42,
            });
        });

        it('publishes System Error when the pipeline throws mid-flight', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockRejectedValueOnce(new Error('db blew up')) // UPDATE Running fails
                .mockResolvedValueOnce({}); // UPDATE System Error

            await processSubmission(1);

            expect(publishRealtime).toHaveBeenCalledTimes(2);
            expect(publishRealtime).toHaveBeenNthCalledWith(2, {
                type: 'submission_update',
                submissionId: 1,
                table: 'submissions',
                overall_status: 'System Error',
                score: 0,
                user_id: 42,
            });
        });
    });

    describe('python submissions', () => {
        it('syntax-checks with py_compile and judges via python3 (no g++)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'print("hi")', language: 'python' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });

            await processSubmission(1);

            // The "compile" phase is a py_compile syntax check, not g++.
            expect(cp.spawn).toHaveBeenCalledTimes(1);
            const [compileCmd, compileArgs] = (cp.spawn as unknown as jest.Mock).mock.calls[0];
            // prlimit wraps the check (existsSync mocked true): prlimit <caps> -- python3 -m py_compile <src>.
            expect(compileArgs).toContain('--');
            const pyIndex = compileArgs.indexOf('--') + 1;
            expect(compileArgs[pyIndex]).toBe('python3');
            expect(compileArgs).toContain('-m');
            expect(compileArgs).toContain('py_compile');
            expect(compileArgs.join(' ')).not.toContain('g++');

            // Judge receives the python interpreter runnable, the language,
            // and the submission's sandbox identity.
            expect(judge).toHaveBeenCalledWith(
                'P1',
                { command: '/usr/bin/python3', args: [expect.stringContaining('.py')] },
                'python',
                expect.anything()
            );
        });

        it('maps a py_compile syntax error to Compilation Error with sanitized stderr', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'def f(:', language: 'python' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE Compilation Error

            // Reproduce py_compile's stderr shape, quoting the REAL source
            // path form (which the sanitizer must neutralize).
            (cp.spawn as unknown as jest.Mock).mockImplementationOnce((cmd: string, args: string[]) => {
                const handlers: Record<string, (...a: unknown[]) => void> = {};
                const child = {
                    pid: 1111,
                    stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
                    stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
                    on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
                    kill: jest.fn(),
                };
                setImmediate(() => {
                    const sourcePath = args[args.length - 1];
                    handlers.stderr?.(Buffer.from(
                        `  File "${sourcePath}", line 1\n    def f(:\n          ^\nSyntaxError: invalid syntax\n`
                    ));
                    handlers.close?.(1, null);
                });
                return child;
            });

            await processSubmission(1);

            expect(db.query).toHaveBeenNthCalledWith(3,
                expect.stringContaining('UPDATE submissions SET overall_status = \'Compilation Error\''),
                [expect.not.stringContaining('/srv/app'), 1]);
            // The Python error message itself survives sanitization.
            const savedResults = (db.query as jest.Mock).mock.calls[2][1][0];
            expect(savedResults).toContain('SyntaxError: invalid syntax');
            expect(savedResults).toContain('solution.py');
            expect(judge).not.toHaveBeenCalled();
        });

        it('does not run the C++ include guard over Python comments', async () => {
            // The guard covers #import / #include_next now; to a Python
            // program these lines are comments, never directives.
            const code = '# import (helpers) below\n# include "/etc/passwd" is not a thing here\nprint(1)\n';
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code, language: 'python' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 0, maxMemoryKb: 0
            });

            await processSubmission(1);

            expect(judge).toHaveBeenCalledTimes(1);
            expect(db.query).not.toHaveBeenCalledWith(
                expect.stringContaining('Compilation Error'), expect.anything());
        });

        it('does not chmod a compiled binary for python (no artifact)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'print(1)', language: 'python' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 0, overallStatus: 'Accepted', maxTimeMs: 0, maxMemoryKb: 0
            });

            await processSubmission(1);

            // Python has no compiled artifact: no chmod of a binary before judging.
            const chmodCalls = (fs.promises.chmod as jest.Mock).mock.calls;
            for (const [target] of chmodCalls) {
                expect(String(target)).not.toContain('.out');
            }
        });
    });

    describe('per-submission workspace isolation (RUNNER-003)', () => {
        const runHappyPath = async (): Promise<void> => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE final results (landed)
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 0, overallStatus: 'Accepted', maxTimeMs: 0, maxMemoryKb: 0
            });
            await processSubmission(1);
        };

        it('creates a per-submission workspace under the OS tmpdir with mode 0711 and NEVER chowns (hotfix 2026-09)', async () => {
            await runHappyPath();

            const mkdtempCalls = (fs.promises.mkdtemp as jest.Mock).mock.calls;
            expect(mkdtempCalls).toHaveLength(1);
            const [prefix] = mkdtempCalls[0];
            // The workspace lives under <tmpdir>/oj-submissions, NOT the old
            // shared dist/services/submissions directory.
            expect(prefix).toContain(path.join('oj-submissions'));
            expect(prefix).not.toContain('dist');
            expect(prefix).not.toContain('services');

            // HOTFIX 2026-09: `chown` is GONE from the pipeline entirely. The
            // production container has no CAP_CHOWN (cap_drop ALL + only
            // SETUID/SETGID), so the old root-writes-then-chowns flow failed
            // silently and left every submission a Compilation Error. In the
            // privileged path ownership is BY CONSTRUCTION (uid-dropped
            // create/write, see the regression test below); in the dev path
            // there is simply no ownership change. Either way: no chown call.
            expect(fs.promises.chown).not.toHaveBeenCalled();

            // ...and locked to 0711: owner full access, others traverse-only
            // (can reach a known file by name but cannot list the directory).
            const chmodCalls = (fs.promises.chmod as jest.Mock).mock.calls;
            const workspaceChmod = chmodCalls.find(([target, mode]: [string, number]) =>
                String(target).includes('oj-submissions') && !String(target).endsWith('.out') && !String(target).endsWith('.cpp') && mode === 0o711);
            expect(workspaceChmod).toBeDefined();
        });

        it('writes the source 0600 (dev path), not 0644 in a shared dir', async () => {
            await runHappyPath();

            const writeCalls = (fs.promises.writeFile as jest.Mock).mock.calls;
            expect(writeCalls).toHaveLength(1);
            const [target, , opts] = writeCalls[0];
            expect(String(target)).toContain('oj-submissions');
            expect(String(target)).toMatch(/solution\.cpp$/);
            expect(opts.mode).toBe(0o600);

            // HOTFIX 2026-09: ownership by construction, never chown.
            expect(fs.promises.chown).not.toHaveBeenCalled();
        });

        it('keeps the compiled binary owner-only executable (0750, identity-owned)', async () => {
            await runHappyPath();

            // g++ ran AS the identity, so the binary is already identity-owned.
            // The pipeline only tightens the mode to 0750 (no world access).
            const binaryChmod = (fs.promises.chmod as jest.Mock).mock.calls
                .find(([target, mode]: [string, number]) => String(target).endsWith('.out'));
            expect(binaryChmod).toBeDefined();
            expect(binaryChmod[1]).toBe(0o750);
        });

        it('passes the same sandbox identity to compile and judge (one identity per submission)', async () => {
            await runHappyPath();

            // The compile spawn runs as the identity...
            const [compileCmd, compileArgs, compileOpts] = (cp.spawn as unknown as jest.Mock).mock.calls[0];
            expect(compileCmd).toBe(JUDGE_CONFIG.PRLIMIT_PATH);
            void compileArgs;
            void compileOpts;
            // ...and judge() receives that same identity so every testcase
            // runs as it too (uid drop is verified end-to-end in production),
            // plus the workspace (the program's TMPDIR).
            const judgeArgs = (judge as jest.Mock).mock.calls[0];
            const { sandbox: identity, workspaceDir, hideProgramStderr } = judgeArgs[3];
            expect(identity).toBeDefined();
            expect(identity.uid).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
            expect(identity.gid).toBe(identity.uid);
            expect(String(workspaceDir)).toContain('oj-submissions');
            expect(hideProgramStderr).toBe(false);
        });

        it('removes the whole workspace (recursive rmtree) after the run', async () => {
            await runHappyPath();

            const rmCalls = (fs.rm as unknown as jest.Mock).mock.calls;
            expect(rmCalls).toHaveLength(1);
            const [target, opts] = rmCalls[0];
            expect(String(target)).toContain('oj-submissions');
            expect(opts).toEqual(expect.objectContaining({ recursive: true, force: true }));
        });
    });

    describe('by-construction workspace ownership (hotfix 2026-09)', () => {
        // REGRESSION TEST for the exact production failure mode: the runner
        // lockdown container (cap_drop ALL + SETUID/SETGID only) has no
        // CAP_CHOWN, so root's chown of the workspace/source failed silently,
        // the source stayed root-owned 0600, and the uid-dropped g++ died
        // with "cc1plus: fatal error: solution.cpp: Permission denied" —
        // EVERY submission was a Compilation Error.
        //
        // The fix: when privileges can be dropped, the workspace directory
        // and its files are created by uid-dropped children, so the sandbox
        // identity owns them BY CONSTRUCTION and chown is never called. These
        // tests simulate the container's capability environment (Linux-root
        // where chown WOULD fail with EPERM) by mocking canDropPrivileges to
        // true and a chown that rejects — then assert the pipeline still
        // compiles via the by-construction path.
        let spawnCalls: Array<[string, string[], Record<string, unknown>]>;

        beforeEach(() => {
            spawnCalls = [];
            // Simulate the production container: Linux, root, uid-drop ready.
            const sandboxProcess = jest.requireActual('../../utils/sandboxProcess');
            jest.spyOn(sandboxProcess, 'canDropPrivileges').mockReturnValue(true);
            // Even if anything DID try to chown, it fails like the container.
            (fs.promises.chown as jest.Mock).mockImplementation(async () => {
                const e = new Error('EPERM: operation not permitted, chown') as NodeJS.ErrnoException;
                e.code = 'EPERM';
                throw e;
            });
            // mktemp -d reports the workspace path on stdout; dd/chmod/rm
            // succeed; the compile (prlimit -- g++) exits 0.
            (cp.spawn as unknown as jest.Mock).mockImplementation(
                (command: string, args: string[], options: Record<string, unknown>) => {
                    spawnCalls.push([command, args, options]);
                    const handlers: Record<string, (...a: unknown[]) => void> = {};
                    const child = {
                        pid: 1111,
                        stdin: {
                            on: jest.fn(),
                            end: jest.fn(),
                        },
                        stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
                        stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
                        on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
                        kill: jest.fn(),
                    };
                    setImmediate(() => {
                        // mktemp prints the created directory path.
                        if (command === 'mktemp') handlers.stdout?.(Buffer.from('/tmp/oj-submissions/sub_1_1_testws\n'));
                        handlers.stdout?.(Buffer.from(''));
                        handlers.stderr?.(Buffer.from(''));
                        handlers.close?.(0, null);
                    });
                    return child;
                }
            );
        });

        const runContainerPipeline = async (): Promise<void> => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // final UPDATE (landed)
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
            });
            await processSubmission(1);
        };

        it('compiles successfully even though chown fails with EPERM (the container capability environment)', async () => {
            await runContainerPipeline();

            // The verdict must NOT be Compilation Error — the exact bug was
            // every submission dying at the compile step.
            const ceUpdate = (db.query as jest.Mock).mock.calls.find(
                ([sql]: [string]) => typeof sql === 'string' && sql.includes("'Compilation Error'")
            );
            expect(ceUpdate).toBeUndefined();
            // Compile succeeded -> judge ran and the final verdict landed.
            expect(judge).toHaveBeenCalledTimes(1);
            const finalUpdate = (db.query as jest.Mock).mock.calls[3];
            expect(String(finalUpdate[0])).toContain('overall_status');
            expect(finalUpdate[1][0]).toBe('Accepted');

            // ...and the pipeline NEVER relied on chown (which would EPERM).
            expect(fs.promises.chown).not.toHaveBeenCalled();
        });

        it('creates the workspace and writes the source via uid-dropped children (ownership by construction)', async () => {
            await runContainerPipeline();

            // Helper spawns run as the sandbox identity with a stripped env.
            const uidDropped = spawnCalls.filter(([, , opts]) =>
                typeof opts.uid === 'number' && opts.uid >= JUDGE_CONFIG.SANDBOX_UID_BASE);
            expect(uidDropped.length).toBeGreaterThanOrEqual(4);

            // 1) the workspace dir is created by a uid-dropped `mktemp -d`
            //    (uid-owned from the instant it exists — no chown needed).
            const mktemp = spawnCalls.find(([cmd, args]) => cmd === 'mktemp' && args.includes('-d'));
            expect(mktemp).toBeDefined();
            expect(mktemp![2].uid as number).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
            expect(mktemp![1].join(' ')).toContain('oj-submissions');
            // No shell anywhere in the helper path.
            expect(mktemp![2].shell).toBeUndefined();

            // 2) the source content reaches the workspace via stdin of a
            //    uid-dropped `dd` (not root's fs.writeFile + chown).
            const dd = spawnCalls.find(([cmd]) => cmd === 'dd');
            expect(dd).toBeDefined();
            expect(dd![2].uid as number).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
            expect(dd![1].join(' ')).toContain('solution.cpp');

            // 3) modes are applied by the owner (uid-dropped chmod), never by
            //    root's fs.chmod (which would EPERM on uid-owned files).
            const chmodCalls = spawnCalls.filter(([cmd]) => cmd === 'chmod');
            expect(chmodCalls.length).toBeGreaterThanOrEqual(3); // 711 dir, 600 src, 750 out
            const modes = chmodCalls.map(([, args]) => args[0]).sort();
            expect(modes).toEqual(expect.arrayContaining(['600', '711', '750']));

            // 4) the compile itself is uid-dropped (as before Phase 0).
            const prlimit = spawnCalls.find(([cmd]) => cmd === JUDGE_CONFIG.PRLIMIT_PATH);
            expect(prlimit).toBeDefined();
            expect(prlimit![2].uid as number).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);

            // 5) cleanup removes the uid-owned workspace as its owner.
            const rm = spawnCalls.find(([cmd]) => cmd === 'rm');
            expect(rm).toBeDefined();
            expect(rm![1]).toEqual(expect.arrayContaining(['-rf']));
            expect(rm![2].uid as number).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
        });

        it('falls back to the dev path (mkdtemp + writeFile, no uid drop) when privileges cannot be dropped', async () => {
            const sandboxProcess = jest.requireActual('../../utils/sandboxProcess');
            (sandboxProcess.canDropPrivileges as jest.Mock).mockReturnValue(false);

            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // final UPDATE (landed)
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
            });

            await processSubmission(1);

            // Dev path: root/current-user mkdtemp + writeFile, no helper spawns.
            expect(fs.promises.mkdtemp).toHaveBeenCalled();
            expect(fs.promises.writeFile).toHaveBeenCalled();
            const helperCmds = spawnCalls.map(([cmd]) => cmd);
            expect(helperCmds).not.toContain('mktemp');
            expect(helperCmds).not.toContain('dd');
            expect(judge).toHaveBeenCalledTimes(1);
            expect(fs.promises.chown).not.toHaveBeenCalled();
        });
    });

    describe('process sweep and scratch cleanup (A4-02 / A9-05)', () => {
        // Production path: nothing may still run under the sandbox uid when it
        // is handed out, after the compile, or when the workspace is removed,
        // and whatever the uid left outside its workspace is removed as the uid.
        let spawnCalls: Array<[string, string[], Record<string, unknown>]>;
        /** Exit code of the Nth `--kill-uid` sweep of this pipeline (default 0). */
        let sweepExitCodes: number[];

        const isSweep = ([, args]: [string, string[], unknown]): boolean => args[0] === '--kill-uid';

        beforeEach(() => {
            spawnCalls = [];
            sweepExitCodes = [];
            const sandboxProcess = jest.requireActual('../../utils/sandboxProcess');
            jest.spyOn(sandboxProcess, 'canDropPrivileges').mockReturnValue(true);
            (cp.spawn as unknown as jest.Mock).mockImplementation(
                (command: string, args: string[], options: Record<string, unknown>) => {
                    spawnCalls.push([command, args, options]);
                    const sweepIndex = spawnCalls.filter(isSweep).length - 1;
                    const exitCode = args[0] === '--kill-uid' ? (sweepExitCodes[sweepIndex] ?? 0) : 0;
                    const handlers: Record<string, (...a: unknown[]) => void> = {};
                    const child = {
                        pid: 1111,
                        stdin: { on: jest.fn(), end: jest.fn() },
                        stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
                        stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
                        on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
                        kill: jest.fn(),
                    };
                    setImmediate(() => {
                        if (command === 'mktemp') handlers.stdout?.(Buffer.from('/tmp/oj-submissions/sub_1_1_testws\n'));
                        handlers.close?.(exitCode, null);
                    });
                    return child;
                }
            );
        });

        afterEach(() => {
            (cp.spawn as unknown as jest.Mock).mockImplementation(benignSpawn as never);
            (fs.promises.opendir as jest.Mock).mockImplementation(async () => {
                throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            });
            (fs.promises.lstat as jest.Mock).mockImplementation(async () => ({ isDirectory: () => true, uid: process.getuid?.() ?? 0 }));
        });

        const queueAcceptedRun = (): void => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // final UPDATE (landed)
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
            });
        };

        it('sweeps the uid before it is used, after the compile, and before the workspace is removed', async () => {
            queueAcceptedRun();

            await processSubmission(1);

            const order = spawnCalls.map(([command, args]) => (args[0] === '--kill-uid' ? 'sweep' : command));
            const sweeps = spawnCalls.filter(isSweep);
            expect(sweeps).toHaveLength(3);
            // Run as root (the helper drops to the uid itself), for the uid the pipeline used.
            const uid = Number(sweeps[0][1][1]);
            expect(uid).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
            // Each identity has its own sweeper uid (real/saved uid of the helper).
            const sweeper = JUDGE_CONFIG.SANDBOX_SWEEPER_UID_BASE + (uid - JUDGE_CONFIG.SANDBOX_UID_BASE);
            for (const [command, args, options] of sweeps) {
                expect(path.basename(command)).toBe('time_wrapper');
                expect(args).toEqual(['--kill-uid', String(uid), String(sweeper)]);
                expect(options.uid).toBeUndefined();
            }
            expect(order.indexOf('sweep')).toBeLessThan(order.indexOf('mktemp'));
            expect(order.indexOf(JUDGE_CONFIG.PRLIMIT_PATH)).toBeLessThan(order.indexOf('sweep', order.indexOf('mktemp')));
            const removeWorkspace = spawnCalls.findIndex(([command, args]) => command === 'rm' && args.includes('/tmp/oj-submissions/sub_1_1_testws'));
            expect(order.lastIndexOf('sweep')).toBeLessThan(removeWorkspace);
            expect((judge as jest.Mock).mock.calls[0][3].sandbox.uid).toBe(uid);
        });

        it('removes, as the uid, what the uid left in the shared scratch dirs', async () => {
            queueAcceptedRun();
            let uid = -1;
            (fs.promises.opendir as jest.Mock).mockImplementation(async (root: string) => {
                if (root !== '/dev/shm') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
                uid = Number(spawnCalls.find(isSweep)?.[1][1]);
                return (async function* entries() {
                    yield { name: 'mine' };
                    yield { name: 'someone-elses' };
                })();
            });
            (fs.promises.lstat as jest.Mock).mockImplementation(async (target: string) => ({
                isDirectory: () => true,
                uid: target === '/dev/shm/mine' ? uid : target === '/dev/shm/someone-elses' ? 0 : (process.getuid?.() ?? 0),
            }));

            await processSubmission(1);

            const removals = spawnCalls.filter(([command, args]) => command === 'rm' && args.includes('/dev/shm/mine'));
            expect(removals).toHaveLength(1);
            expect(removals[0][1]).toEqual(['-rf', '--', '/dev/shm/mine']);
            expect(removals[0][2].uid).toBe(uid);
            expect(spawnCalls.some(([, args]) => args.includes('/dev/shm/someone-elses'))).toBe(false);
        });

        it('fails closed (System Error, nothing compiled) when no identity can be swept before use', async () => {
            // Every attempt on every candidate identity fails.
            sweepExitCodes = Array.from(
                { length: JUDGE_CONFIG.SANDBOX_SWEEP_ATTEMPTS * JUDGE_CONFIG.SANDBOX_ACQUIRE_CANDIDATES },
                () => 3,
            );
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE System Error

            await processSubmission(1);

            expect(db.query).toHaveBeenNthCalledWith(3,
                expect.stringContaining('UPDATE submissions SET overall_status = \'System Error\''), [1]);
            const commands = spawnCalls.map(([command]) => command);
            expect(commands).not.toContain('mktemp');
            expect(commands).not.toContain(JUDGE_CONFIG.PRLIMIT_PATH);
            expect(judge).not.toHaveBeenCalled();
        });

        it('fails closed (System Error, nothing runs) when the compile leaves processes that cannot be killed', async () => {
            // Hand-out sweep passes; every attempt of the post-compile sweep fails.
            sweepExitCodes = [0, ...Array.from({ length: JUDGE_CONFIG.SANDBOX_SWEEP_ATTEMPTS }, () => 3)];
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE System Error

            await processSubmission(1);

            expect(db.query).toHaveBeenNthCalledWith(3,
                expect.stringContaining('UPDATE submissions SET overall_status = \'System Error\''), [1]);
            expect(judge).not.toHaveBeenCalled();
        });

        it('asks the judge to hide program stderr on header problems only', async () => {
            const sandboxProcess = jest.requireActual('../../utils/sandboxProcess');
            jest.spyOn(sandboxProcess, 'removeSandboxFiles').mockResolvedValue(undefined);
            (getHeaderJudgeSpec as jest.Mock).mockResolvedValue({
                problemType: 'header',
                submissionFilename: 'student.h',
                graderFiles: [{ filename: 'main.cpp', content: Buffer.from('#include "student.h"\nint main(){}\n') }],
            });
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'H1', user_id: 7, code: 'void f(){}\n', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 }); // final UPDATE (landed)
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
            });

            await processSubmission(1);

            expect((judge as jest.Mock).mock.calls[0][3]).toMatchObject({ hideProgramStderr: true });
        });
    });

    describe('header problems (student.h compiled with secret grader files)', () => {
        // A header problem's submission is ONE file (student.h) compiled in the
        // same translation unit as the problem's secret grader sources. The
        // pipeline must therefore: reject non-C++ and inline assembly up front,
        // write every grader file next to the submission, compile the grader
        // .cpp sources, and then SCRUB every source from the workspace before
        // the binary ever runs — otherwise the student's program could just
        // fopen() the secret main.cpp it was linked against.
        const HEADER_SPEC = {
            problemType: 'header' as const,
            submissionFilename: 'student.h',
            // DB order (ORDER BY filename): main.cpp, queue.h.
            graderFiles: [
                { filename: 'main.cpp', content: Buffer.from('#include "queue.h"\nint main(){}\n') },
                { filename: 'queue.h', content: Buffer.from('#include "student.h"\n') },
            ],
        };
        const GOOD_HEADER = 'void push(int){}\n';

        // "สวัสดี" encoded in TIS-620/CP874, the encoding a Thai course's
        // editor still saves in. These bytes are NOT valid UTF-8, so decoding
        // them to a JS string replaces every one with U+FFFD and re-encoding
        // yields different bytes: the grader's literal becomes mojibake and
        // every student gets Wrong Answer with nothing to see.
        const TIS620_BYTES = Buffer.from([0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5]);
        const TIS620_GRADER = Buffer.concat([
            Buffer.from('#include <cstdio>\n#include "queue.h"\nint main(){ std::printf("'),
            TIS620_BYTES,
            Buffer.from('\\n"); }\n'),
        ]);
        const TIS620_SPEC = {
            problemType: 'header' as const,
            submissionFilename: 'student.h',
            graderFiles: [
                { filename: 'main.cpp', content: TIS620_GRADER },
                { filename: 'queue.h', content: Buffer.from('#include "student.h"\n') },
            ],
        };

        const mockRow = (code: string, language: 'cpp' | 'python' = 'cpp') =>
            ({ rows: [{ problem_id: 'H1', user_id: 7, code, language }] });

        // Restore the module mock's default compile behaviour: the privileged
        // describe below installs its own spawn stub, and a jest.fn's
        // implementation survives clearAllMocks.
        afterEach(() => {
            (cp.spawn as unknown as jest.Mock).mockImplementation(benignSpawn as never);
        });

        describe('up-front rejections', () => {
            it('rejects a non-C++ submission as a Compilation Error without compiling', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(HEADER_SPEC);
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow('print(1)', 'python'))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                expect(db.query).toHaveBeenNthCalledWith(3,
                    expect.stringContaining('UPDATE submissions SET overall_status = \'Compilation Error\''),
                    [expect.any(String), 1]);
                expect(compilationErrorOutput(2)).toBe('This problem accepts C++ only.');
                expect(cp.spawn).not.toHaveBeenCalled();
                expect(judge).not.toHaveBeenCalled();
            });

            it('rejects inline assembly as a Compilation Error without compiling', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(HEADER_SPEC);
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow('asm(".incbin \\"main.cpp\\"");\n'))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                expect(db.query).toHaveBeenNthCalledWith(3,
                    expect.stringContaining('UPDATE submissions SET overall_status = \'Compilation Error\''),
                    [expect.any(String), 1]);
                expect(compilationErrorOutput(2)).toBe(
                    'Compilation rejected: inline assembly ("asm") is not allowed in this problem.');
                expect(cp.spawn).not.toHaveBeenCalled();
                expect(judge).not.toHaveBeenCalled();
            });

            it('still rejects a forbidden #include with the standard message', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(HEADER_SPEC);
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow('#include "/etc/passwd"\n'))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                expect(compilationErrorOutput(2)).toContain('#include of a non-permitted path');
                expect(cp.spawn).not.toHaveBeenCalled();
            });

            it('names the submitted header in a lexical rejection', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(HEADER_SPEC);
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow('int a;\nconst char* s = "x"R"y(z)y";\n'))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                expect(compilationErrorOutput(2)).toMatch(/^Compilation rejected \(student\.h:2\): /);
                expect(cp.spawn).not.toHaveBeenCalled();
            });

            it('rejects redefining a name the grader uses, without quoting the grader', async () => {
                // queue.h (a grader file) includes student.h; `main` is a
                // grader identifier, so a student macro may not rewrite it.
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(HEADER_SPEC);
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow('#define main(...) static_assert(false, #__VA_ARGS__)\n'))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                const output = compilationErrorOutput(2);
                expect(output).toContain('the grader uses that name');
                expect(output).not.toContain('#include "queue.h"');
                expect(cp.spawn).not.toHaveBeenCalled();
            });

            it('allows a quoted #include of a public starter header only', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue({ ...HEADER_SPEC, starterFilenames: ['queue.h', 'student.h'] });
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow('#include "main.cpp"\n'))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                expect(compilationErrorOutput(2)).toContain('public headers: "queue.h"');
                expect(cp.spawn).not.toHaveBeenCalled();
            });
        });

        describe('privileged (production) path', () => {
            let spawnCalls: Array<[string, string[], Record<string, unknown>]>;
            let removeFiles: jest.SpyInstance;

            beforeEach(() => {
                spawnCalls = [];
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(HEADER_SPEC);
                const sandboxProcess = jest.requireActual('../../utils/sandboxProcess');
                jest.spyOn(sandboxProcess, 'canDropPrivileges').mockReturnValue(true);
                removeFiles = jest.spyOn(sandboxProcess, 'removeSandboxFiles').mockResolvedValue(undefined);
                (cp.spawn as unknown as jest.Mock).mockImplementation(
                    (command: string, args: string[], options: Record<string, unknown>) => {
                        spawnCalls.push([command, args, options]);
                        return benignSpawn(command);
                    }
                );
            });

            const runHeaderPipeline = async (): Promise<void> => {
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow(GOOD_HEADER))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}) // UPDATE Running
                    .mockResolvedValueOnce({ rowCount: 1 }); // final UPDATE (landed)
                (judge as jest.Mock).mockResolvedValueOnce({
                    results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
                });
                await processSubmission(1);
            };

            /** The g++ argv of each compiler run, in order (prlimit-wrapped). */
            const gppRuns = (): string[][] => spawnCalls
                .filter(([cmd]) => cmd === JUDGE_CONFIG.PRLIMIT_PATH)
                .map(([, args]) => {
                    const gpp = args.indexOf('--') + 1;
                    expect(args[gpp]).toBe('g++');
                    return args.slice(gpp);
                });

            it('compiles the grader sources to assembly only (-S), with the header diagnostics flags', async () => {
                await runHeaderPipeline();

                const runs = gppRuns();
                expect(runs).toHaveLength(2);
                const [compileArgs] = runs;
                // Standard C++ flags are reused verbatim, plus the header flags
                // that keep the secret grader source OUT of diagnostics and
                // bound their length.
                expect(compileArgs).toEqual(expect.arrayContaining([
                    '-std=c++20',
                    '-fsanitize=signed-integer-overflow',
                    '-fno-sanitize-recover=signed-integer-overflow',
                    '-fno-diagnostics-show-caret',
                    '-fmax-errors=10',
                    '-S',
                    'main.cpp',
                ]));
                // Compile proper only: no output binary, no assembler yet.
                expect(compileArgs).not.toContain('-o');
                expect(compileArgs).not.toContain('solution.out');
                // The submitted header and the grader's .h are compiled only
                // through #include — never named on the g++ command line.
                expect(compileArgs).not.toContain('solution.cpp');
                expect(compileArgs).not.toContain('student.h');
                expect(compileArgs).not.toContain('queue.h');
                // No absolute server paths in argv.
                expect(compileArgs.join(' ')).not.toContain('/tmp/oj-submissions');
            });

            it('assembles and links the .s files into a stripped binary in a second run', async () => {
                await runHeaderPipeline();

                const [, linkArgs] = gppRuns();
                expect(linkArgs).toEqual([
                    'g++',
                    '-std=c++20',
                    '-fsanitize=signed-integer-overflow',
                    '-fno-sanitize-recover=signed-integer-overflow',
                    '-s',
                    'main.s',
                    '-o',
                    'solution.out',
                ]);
            });

            it('compiles every suffix g++ treats as C++ (.CPP, .c++) and links their .s files', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue({
                    ...HEADER_SPEC,
                    graderFiles: [
                        { filename: 'helper.c++', content: Buffer.from('int helper(){return 1;}\n') },
                        { filename: 'main.CPP', content: Buffer.from('#include "queue.h"\nint main(){}\n') },
                        { filename: 'notes.Cpp', content: Buffer.from('not a source\n') },
                        { filename: 'queue.h', content: Buffer.from('#include "student.h"\n') },
                    ],
                });
                await runHeaderPipeline();

                const [compileArgs, linkArgs] = gppRuns();
                expect(compileArgs.slice(compileArgs.indexOf('-S') + 1)).toEqual(['helper.c++', 'main.CPP']);
                expect(linkArgs.slice(linkArgs.indexOf('-s') + 1)).toEqual(['helper.s', 'main.s', '-o', 'solution.out']);
            });

            it('writes every grader file and the submission into the workspace as the sandbox uid', async () => {
                await runHeaderPipeline();

                const written = spawnCalls.filter(([cmd]) => cmd === 'dd').map(([, args]) => args.join(' '));
                expect(written).toHaveLength(3);
                expect(written.some((a) => a.includes('main.cpp'))).toBe(true);
                expect(written.some((a) => a.includes('queue.h'))).toBe(true);
                expect(written.some((a) => a.includes('student.h'))).toBe(true);
                expect(written.some((a) => a.includes('solution.cpp'))).toBe(false);
                for (const [, , opts] of spawnCalls.filter(([cmd]) => cmd === 'dd')) {
                    expect(opts.uid as number).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
                }
            });

            it('pipes grader file bytes into the workspace verbatim (no UTF-8 round trip)', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(TIS620_SPEC);
                const writtenBytes = new Map<string, unknown>();
                (cp.spawn as unknown as jest.Mock).mockImplementation((command: string, args: string[]) => {
                    const child = benignSpawn(command);
                    if (command === 'dd') {
                        const target = String(args[0]).replace(/^of=/, '');
                        child.stdin.end = jest.fn((payload: unknown) => {
                            writtenBytes.set(path.basename(target), payload);
                        });
                    }
                    return child;
                });

                await runHeaderPipeline();

                const mainCpp = writtenBytes.get('main.cpp');
                expect(Buffer.isBuffer(mainCpp)).toBe(true);
                expect(mainCpp).toEqual(TIS620_GRADER);
                expect((mainCpp as Buffer).includes(TIS620_BYTES)).toBe(true);
                // The submitted code stays a string: it comes from a TEXT column.
                expect(writtenBytes.get('student.h')).toBe(GOOD_HEADER);
            });

            it('scrubs every source BEFORE the assembler runs and the .s files BEFORE the binary runs', async () => {
                await runHeaderPipeline();

                expect(removeFiles).toHaveBeenCalledTimes(2);
                const [workspaceDir, fileNames, options] = removeFiles.mock.calls[0];
                expect(String(workspaceDir)).toContain('oj-submissions');
                expect(fileNames).toEqual(['main.cpp', 'queue.h', 'student.h']);
                expect((options as { sandbox: { uid: number } }).sandbox.uid)
                    .toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
                expect(removeFiles.mock.calls[1][1]).toEqual(['main.s']);

                // Order: -S compile < source scrub < assemble+link < .s scrub < run.
                const spawnOrder = (cp.spawn as unknown as jest.Mock).mock.invocationCallOrder;
                const compilerRuns = (cp.spawn as unknown as jest.Mock).mock.calls
                    .map(([cmd]: [string], index: number) => ({ cmd, order: spawnOrder[index] }))
                    .filter(({ cmd }) => cmd === JUDGE_CONFIG.PRLIMIT_PATH)
                    .map(({ order }) => order);
                const [sourceScrub, assemblyScrub] = removeFiles.mock.invocationCallOrder;
                expect(compilerRuns[0]).toBeLessThan(sourceScrub);
                expect(sourceScrub).toBeLessThan(compilerRuns[1]);
                expect(compilerRuns[1]).toBeLessThan(assemblyScrub);
                expect(assemblyScrub).toBeLessThan((judge as jest.Mock).mock.invocationCallOrder[0]);
                expect(judge).toHaveBeenCalledWith('H1', { command: expect.stringContaining('.out'), args: [] }, 'cpp', expect.anything());
            });

            it('fails the submission (System Error) and never assembles or runs when the scrub fails', async () => {
                removeFiles.mockRejectedValue(new Error('rm: Permission denied'));
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow(GOOD_HEADER))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE System Error

                await processSubmission(1);

                expect(judge).not.toHaveBeenCalled();
                // Only the -S run happened: the assembler never ran next to
                // grader sources that were supposed to be gone.
                expect(gppRuns()).toHaveLength(1);
                expect(db.query).toHaveBeenNthCalledWith(3,
                    expect.stringContaining('UPDATE submissions SET overall_status = \'System Error\''), [1]);
            });

            it('fails the submission (System Error) and never runs the binary when the .s scrub fails', async () => {
                removeFiles.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rm: Permission denied'));
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow(GOOD_HEADER))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE System Error

                await processSubmission(1);

                expect(judge).not.toHaveBeenCalled();
                expect(db.query).toHaveBeenNthCalledWith(3,
                    expect.stringContaining('UPDATE submissions SET overall_status = \'System Error\''), [1]);
            });

            it('reports an assembler failure (e.g. an injected .incbin with nothing to read) as a Compilation Error', async () => {
                // The -S run succeeds; the assemble+link run fails the way as
                // does when the file an injected `.incbin` names is gone.
                let compilerRun = 0;
                (cp.spawn as unknown as jest.Mock).mockImplementation(
                    (command: string, args: string[], options: Record<string, unknown>) => {
                        spawnCalls.push([command, args, options]);
                        if (command === JUDGE_CONFIG.PRLIMIT_PATH) compilerRun += 1;
                        if (command !== JUDGE_CONFIG.PRLIMIT_PATH || compilerRun === 1) return benignSpawn(command);
                        const handlers: Record<string, (...a: unknown[]) => void> = {};
                        const child = {
                            pid: 1111,
                            stdin: { on: jest.fn(), end: jest.fn() },
                            stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
                            stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
                            on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
                            kill: jest.fn(),
                        };
                        setImmediate(() => {
                            handlers.stderr?.(Buffer.from('main.s: Assembler messages:\nmain.s:7: Error: file not found: main.cpp\n'));
                            handlers.close?.(1, null);
                        });
                        return child;
                    }
                );
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow(GOOD_HEADER))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                expect(compilationErrorOutput(2)).toContain('file not found: main.cpp');
                expect(removeFiles).toHaveBeenCalledTimes(1);
                expect(judge).not.toHaveBeenCalled();
            });

            it('keeps the real student.h name in compile diagnostics but no server paths', async () => {
                (cp.spawn as unknown as jest.Mock).mockImplementation(
                    (command: string, args: string[]) => {
                        const handlers: Record<string, (...a: unknown[]) => void> = {};
                        const child = {
                            pid: 1111,
                            stdin: { on: jest.fn(), end: jest.fn() },
                            stdout: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stdout = fn; } },
                            stderr: { on: (_e: string, fn: (...a: unknown[]) => void) => { handlers.stderr = fn; } },
                            on: (event: string, fn: (...a: unknown[]) => void) => { handlers[event] = fn; },
                            kill: jest.fn(),
                        };
                        const isCompile = command === JUDGE_CONFIG.PRLIMIT_PATH;
                        setImmediate(() => {
                            if (command === 'mktemp') handlers.stdout?.(Buffer.from('/tmp/oj-submissions/sub_1_1_testws\n'));
                            if (isCompile) {
                                handlers.stderr?.(Buffer.from(
                                    'In file included from main.cpp:1:\n'
                                    + 'student.h:3:5: error: expected \';\' before \'}\' token\n'
                                    + '/tmp/oj-submissions/sub_1_1_testws/student.h:4:1: error: stray token\n'
                                ));
                            }
                            handlers.close?.(isCompile ? 1 : 0, null);
                        });
                        void args;
                        return child;
                    }
                );
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow('void push(int){ }}\n'))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}); // UPDATE Compilation Error

                await processSubmission(1);

                const saved = (db.query as jest.Mock).mock.calls[2][1][0] as string;
                // Diagnostics must still point at the file the student wrote...
                expect(saved).toContain('student.h:3:5: error');
                expect(saved).not.toContain('solution.cpp');
                // ...but never disclose the workspace path.
                expect(saved).not.toContain('oj-submissions');
                expect(saved).toContain('student.h:4:1: error: stray token');
                expect(judge).not.toHaveBeenCalled();
            });
        });

        describe('dev (unprivileged) path', () => {
            it('writes the files 0600 and removes them with fs.promises.rm before judging', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(HEADER_SPEC);
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow(GOOD_HEADER))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}) // UPDATE Running
                    .mockResolvedValueOnce({ rowCount: 1 }); // final UPDATE (landed)
                (judge as jest.Mock).mockResolvedValueOnce({
                    results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
                });

                await processSubmission(1);

                const writes = (fs.promises.writeFile as jest.Mock).mock.calls;
                expect(writes).toHaveLength(3);
                expect(writes.map(([target]: [string]) => path.basename(String(target))))
                    .toEqual(['main.cpp', 'queue.h', 'student.h']);
                for (const [, , opts] of writes) expect(opts.mode).toBe(0o600);

                const removed = (fs.promises.rm as jest.Mock).mock.calls
                    .map(([target]: [string]) => path.basename(String(target)));
                expect(removed).toEqual(['main.cpp', 'queue.h', 'student.h', 'main.s']);
                expect(judge).toHaveBeenCalledTimes(1);
            });

            it('writes grader bytes verbatim too (fs path stays byte-exact)', async () => {
                (getHeaderJudgeSpec as jest.Mock).mockResolvedValue(TIS620_SPEC);
                (db.query as jest.Mock)
                    .mockResolvedValueOnce(mockRow(GOOD_HEADER))
                    .mockResolvedValueOnce({}) // UPDATE Compiling
                    .mockResolvedValueOnce({}) // UPDATE Running
                    .mockResolvedValueOnce({ rowCount: 1 }); // final UPDATE (landed)
                (judge as jest.Mock).mockResolvedValueOnce({
                    results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
                });

                await processSubmission(1);

                const writes = (fs.promises.writeFile as jest.Mock).mock.calls;
                const mainWrite = writes.find(([target]: [string]) => path.basename(String(target)) === 'main.cpp')!;
                expect(Buffer.isBuffer(mainWrite[1])).toBe(true);
                expect(mainWrite[1]).toEqual(TIS620_GRADER);
            });
        });

        it('leaves a standard problem on the unchanged single-source path', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 1 });
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 100, overallStatus: 'Accepted', maxTimeMs: 1, maxMemoryKb: 1024
            });

            await processSubmission(1);

            const [, compileArgs] = (cp.spawn as unknown as jest.Mock).mock.calls[0];
            expect(compileArgs).toContain('solution.cpp');
            expect(compileArgs).not.toContain('-fno-diagnostics-show-caret');
            expect(fs.promises.rm).not.toHaveBeenCalled();
            expect((fs.promises.writeFile as jest.Mock).mock.calls).toHaveLength(1);
        });
    });

    describe('stale-verdict guard (JUDGE-004)', () => {
        it('discards a judge result when the final UPDATE matches no judgeable row (rowCount 0)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', user_id: 42, code: 'int main(){}', language: 'cpp' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({ rowCount: 0 }); // final UPDATE: row gone/terminal

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });

            await processSubmission(1);

            // The final UPDATE is CONDITIONAL on a judgeable status.
            const finalSql = (db.query as jest.Mock).mock.calls[3][0] as string;
            expect(finalSql).toContain("overall_status IN ('Pending', 'Compiling', 'Running')");

            // A discarded verdict must not publish, ping the scoreboard, or
            // award XP — a stale run steps aside entirely.
            expect(publishRealtime).toHaveBeenCalledTimes(2); // Compiling + Running only
            expect(awardSolveReward).not.toHaveBeenCalled();
        });
    });

    describe('startup sweep for orphaned submissions (JUDGE-003 / DB-13)', () => {
        // The sweep dispatches through the tracked judge queue; capture tasks.
        let sweepTasks: Array<() => Promise<void>>;
        beforeEach(() => {
            sweepTasks = [];
            (enqueueTrackedJudgeTask as unknown as jest.Mock).mockImplementation(
                (task: () => Promise<void>) => { sweepTasks.push(task); }
            );
        });

        it('re-enqueues Pending rows and marks Compiling/Running rows System Error, in both pools', async () => {
            (db.query as jest.Mock)
                // submissions pool
                .mockResolvedValueOnce({ rows: [{ id: 11, contest_id: null }, { id: 12, contest_id: null }] }) // Pending
                .mockResolvedValueOnce({ rowCount: 2 })                                                      // Compiling/Running
                // contest_submissions pool
                .mockResolvedValueOnce({ rows: [{ id: 21, contest_id: 5 }] })                                // Pending
                .mockResolvedValueOnce({ rowCount: 1 });                                                     // Compiling/Running

            const result = await sweepOrphanedSubmissions();

            expect(result).toEqual({ requeued: 3, systemErrored: 3 });
            expect(sweepTasks).toHaveLength(3);

            // Pending re-enqueue: a SELECT, not a destructive reset.
            const pendingSql = (db.query as jest.Mock).mock.calls[0][0] as string;
            expect(pendingSql).toContain('SELECT id');
            expect(pendingSql).toContain("overall_status = 'Pending'");

            // Stuck rows land a terminal System Error with a clear message.
            const stuckSql = (db.query as jest.Mock).mock.calls[1][0] as string;
            expect(stuckSql).toContain("overall_status IN ('Compiling', 'Running')");
            expect(stuckSql).toContain("'System Error'");
            const stuckResults = (db.query as jest.Mock).mock.calls[1][1][0] as string;
            expect(stuckResults).toContain('interrupted by a server restart');

            // The enqueued tasks dispatch into the right pipelines: each
            // pipeline's first query SELECTs its row by id from the right
            // table (subsequent queries return no rows, ending the pipeline).
            (db.query as jest.Mock).mockResolvedValue({ rows: [] });
            await Promise.all(sweepTasks.map((task) => task()));
            const selectCalls = (db.query as jest.Mock).mock.calls
                .filter(([sql]: [string]) => sql.startsWith('SELECT * FROM'));
            expect(selectCalls).toEqual(expect.arrayContaining([
                ['SELECT * FROM submissions WHERE id = $1', [11]],
                ['SELECT * FROM submissions WHERE id = $1', [12]],
                ['SELECT * FROM contest_submissions WHERE id = $1', [21]],
            ]));
        });

        it('is a no-op when nothing is orphaned', async () => {
            (db.query as jest.Mock)
                .mockResolvedValue({ rows: [], rowCount: 0 });

            const result = await sweepOrphanedSubmissions();

            expect(result).toEqual({ requeued: 0, systemErrored: 0 });
            expect(sweepTasks).toHaveLength(0);
        });
    });
});
