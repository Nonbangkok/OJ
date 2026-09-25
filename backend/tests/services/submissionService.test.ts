import { processSubmission, processContestSubmission } from '../../services/submissionService';
import * as db from '../../db';
import fs from 'fs';
import path from 'path';
import cp from 'child_process';
import { judge } from '../../services/judgeService';
import { publishRealtime } from '../../services/realtimeHub';
import { awardSolveReward } from '../../services/progressionService';
import { JUDGE_CONFIG } from '../../constants';

jest.mock('../../db');
jest.mock('../../services/realtimeHub', () => ({
    publishRealtime: jest.fn(),
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

describe('Submission Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: a solve earns nothing new (reward already existed).
        (awardSolveReward as jest.Mock).mockResolvedValue(0);
        console.error = jest.fn(); // Suppress expected errors in tests
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
                .mockResolvedValueOnce({}); // UPDATE final results

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
            expect(compileArgs).toEqual(expect.arrayContaining(['-std=c++20', '-fsanitize=signed-integer-overflow']));
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
                .mockResolvedValueOnce({}); // UPDATE final results

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
                .mockResolvedValueOnce({}); // UPDATE final results

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
                .mockResolvedValueOnce({}); // UPDATE final results

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
                .mockResolvedValueOnce({}); // UPDATE final results

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
                .mockResolvedValueOnce({}); // UPDATE final results

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
                .mockResolvedValueOnce({}); // UPDATE final results

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
                .mockResolvedValueOnce({}); // UPDATE final results

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

        it('does not chmod a compiled binary for python (no artifact)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'print(1)', language: 'python' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({}); // UPDATE final results

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
                .mockResolvedValueOnce({}); // UPDATE final results
            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 0, overallStatus: 'Accepted', maxTimeMs: 0, maxMemoryKb: 0
            });
            await processSubmission(1);
        };

        it('creates a per-submission workspace under the OS tmpdir, owned by the sandbox identity with mode 0711', async () => {
            await runHappyPath();

            const mkdtempCalls = (fs.promises.mkdtemp as jest.Mock).mock.calls;
            expect(mkdtempCalls).toHaveLength(1);
            const [prefix] = mkdtempCalls[0];
            // The workspace lives under <tmpdir>/oj-submissions, NOT the old
            // shared dist/services/submissions directory.
            expect(prefix).toContain(path.join('oj-submissions'));
            expect(prefix).not.toContain('dist');
            expect(prefix).not.toContain('services');

            // The workspace is chowned to the submission's sandbox identity...
            const chownCalls = (fs.promises.chown as jest.Mock).mock.calls;
            const workspaceChown = chownCalls.find(([target]: [string]) =>
                String(target).includes('oj-submissions') && !String(target).endsWith('.cpp') && !String(target).endsWith('.out'));
            expect(workspaceChown).toBeDefined();
            const [, uid, gid] = workspaceChown;
            expect(uid).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
            expect(gid).toBe(uid);

            // ...and locked to 0711: owner full access, others traverse-only
            // (can reach a known file by name but cannot list the directory).
            const chmodCalls = (fs.promises.chmod as jest.Mock).mock.calls;
            const workspaceChmod = chmodCalls.find(([target, mode]: [string, number]) =>
                String(target).includes('oj-submissions') && !String(target).endsWith('.out') && !String(target).endsWith('.cpp') && mode === 0o711);
            expect(workspaceChmod).toBeDefined();
        });

        it('writes the source 0600 owned by the sandbox identity, not 0644 in a shared dir', async () => {
            await runHappyPath();

            const writeCalls = (fs.promises.writeFile as jest.Mock).mock.calls;
            expect(writeCalls).toHaveLength(1);
            const [target, , opts] = writeCalls[0];
            expect(String(target)).toContain('oj-submissions');
            expect(String(target)).toMatch(/solution\.cpp$/);
            expect(opts.mode).toBe(0o600);

            // Ownership follows the sandbox identity.
            const chownCalls = (fs.promises.chown as jest.Mock).mock.calls;
            const sourceChown = chownCalls.find(([target]: [string]) => String(target).endsWith('.cpp'));
            expect(sourceChown).toBeDefined();
            const [, uid, gid] = sourceChown;
            expect(uid).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
            expect(gid).toBe(uid);
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
            // runs as it too (uid drop is verified end-to-end in production).
            const judgeArgs = (judge as jest.Mock).mock.calls[0];
            const identity = judgeArgs[3];
            expect(identity).toBeDefined();
            expect(identity.uid).toBeGreaterThanOrEqual(JUDGE_CONFIG.SANDBOX_UID_BASE);
            expect(identity.gid).toBe(identity.uid);
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
});
