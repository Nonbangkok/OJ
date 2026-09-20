import { processSubmission, processContestSubmission } from '../../services/submissionService';
import * as db from '../../db';
import fs from 'fs';
import cp from 'child_process';
import { judge } from '../../services/judgeService';

jest.mock('../../db');
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    unlink: jest.fn((path, cb) => cb && cb(null)),
    promises: {
        writeFile: jest.fn(),
        chmod: jest.fn(),
    }
}));
jest.mock('child_process', () => ({
    // exec is promisified in the service and now called as
    // exec(cmd, options, callback) since a compile timeout/maxBuffer was added.
    exec: jest.fn((cmd, options, cb) => {
        const callback = typeof options === 'function' ? options : cb;
        callback(null, { stdout: '', stderr: '' });
    })
}));
jest.mock('../../services/judgeService');

describe('Submission Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

            (fs.existsSync as jest.Mock).mockReturnValue(true);

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

            // Verify compilation was called with a timeout/maxBuffer guard
            expect(cp.exec).toHaveBeenCalledWith(
                expect.stringContaining('g++ -std=c++20'),
                expect.objectContaining({ timeout: expect.any(Number), maxBuffer: expect.any(Number) }),
                expect.any(Function)
            );

            // Verify Running status updated
            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE submissions SET overall_status = \'Running\''), [1]);

            // Verify judge was called with the compiled binary runnable and language
            expect(judge).toHaveBeenCalledWith('P1', { command: expect.stringContaining('.out'), args: [] }, 'cpp');

            // Verify final results saved
            expect(db.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE submissions\n       SET overall_status'), ['Accepted', 100, JSON.stringify([{ testCase: 1, status: 'Accepted' }]), 10, 2048, 1]);
        });

        it('should handle compilation errors correctly', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'bad code', language: 'cpp' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE final status

            (fs.existsSync as jest.Mock).mockReturnValue(true);

            // Mock cp.exec to fail for compilation. exec is now called as
            // exec(cmd, options, callback), so resolve the callback from either arg.
            (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, options, cb) => {
                const callback = typeof options === 'function' ? options : cb;
                callback({ stderr: 'syntax error' }, null, 'syntax error');
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

            (fs.existsSync as jest.Mock).mockReturnValue(true);

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

    describe('python submissions', () => {
        it('syntax-checks with py_compile and judges via python3 (no g++)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'print("hi")', language: 'python' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({}); // UPDATE final results

            (fs.existsSync as jest.Mock).mockReturnValue(true);

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [{ testCase: 1, status: 'Accepted' }],
                score: 100,
                overallStatus: 'Accepted',
                maxTimeMs: 10,
                maxMemoryKb: 2048
            });

            await processSubmission(1);

            // The "compile" phase is a py_compile syntax check, not g++.
            expect(cp.exec).toHaveBeenCalledTimes(1);
            const compileCmd = (cp.exec as unknown as jest.Mock).mock.calls[0][0];
            expect(compileCmd).toContain('python3 -m py_compile');
            expect(compileCmd).not.toContain('g++');

            // Judge receives the python interpreter runnable plus the language.
            expect(judge).toHaveBeenCalledWith(
                'P1',
                { command: 'python3', args: [expect.stringContaining('.py')] },
                'python'
            );
        });

        it('maps a py_compile syntax error to Compilation Error with sanitized stderr', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'def f(:', language: 'python' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE Compilation Error

            (fs.existsSync as jest.Mock).mockReturnValue(true);

            (cp.exec as unknown as jest.Mock).mockImplementationOnce((cmd, options, cb) => {
                const callback = typeof options === 'function' ? options : cb;
                // Reproduce py_compile's stderr shape, quoting the REAL source
                // path (which the sanitizer must neutralize).
                const sourcePath = String(cmd).replace('python3 -m py_compile ', '');
                callback({
                    stderr: `  File "${sourcePath}", line 1\n    def f(:\n          ^\nSyntaxError: invalid syntax\n`
                }, null, '');
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

        it('keeps the source file readable and does not chmod/unlink a binary for python', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'print(1)', language: 'python' }] })
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({}); // UPDATE final results

            (fs.existsSync as jest.Mock).mockReturnValue(true);

            (judge as jest.Mock).mockResolvedValueOnce({
                results: [], score: 0, overallStatus: 'Accepted', maxTimeMs: 0, maxMemoryKb: 0
            });

            await processSubmission(1);

            // Python has no compiled artifact: no chmod before judging.
            expect(fs.promises.chmod).not.toHaveBeenCalled();
        });
    });
});
