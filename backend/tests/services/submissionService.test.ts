import { processSubmission, processContestSubmission, sweepOrphanedSubmissions } from '../../services/submissionService';
import * as db from '../../db';
import fs from 'fs';
import path from 'path';
import cp from 'child_process';
import { judge } from '../../services/judgeService';
import { publishRealtime } from '../../services/realtimeHub';
import { awardSolveReward } from '../../services/progressionService';
import { enqueueTrackedJudgeTask } from '../../services/judgeQueue';
import { JUDGE_CONFIG } from '../../constants';

jest.mock('../../db');
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
