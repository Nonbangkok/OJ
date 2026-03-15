const { processSubmission, processContestSubmission } = require('../../services/submissionService');
const db = require('../../db');
const fs = require('fs');
const cp = require('child_process');
const { judge } = require('../../services/judgeService');

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
    exec: jest.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' }))
}));
jest.mock('../../services/judgeService');

describe('Submission Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.error = jest.fn(); // Suppress expected errors in tests
    });

    describe('processSubmission', () => {
        it('should handle missing submission gracefully', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // Not found

            await processSubmission(1);

            expect(db.query).toHaveBeenCalledWith('SELECT * FROM submissions WHERE id = $1', [1]);
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
            expect(fs.promises.writeFile).not.toHaveBeenCalled();
        });

        it('should update status to Compiling and run g++ successfully', async () => {
            // Mock db queries: 1. SELECT, 2. UPDATE Compiling, 3. UPDATE Running, 4. UPDATE Results
            db.query
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'int main(){}' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({}); // UPDATE final results

            fs.existsSync.mockReturnValue(true);

            judge.mockResolvedValueOnce({
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

            // Verify compilation was called
            expect(cp.exec).toHaveBeenCalledWith(expect.stringContaining('g++ -std=c++20'), expect.any(Function));

            // Verify Running status updated
            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE submissions SET overall_status = \'Running\''), [1]);

            // Verify judge was called
            expect(judge).toHaveBeenCalledWith('P1', expect.stringContaining('.out'));

            // Verify final results saved
            expect(db.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE submissions\n       SET overall_status'), ['Accepted', 100, JSON.stringify([{ testCase: 1, status: 'Accepted' }]), 10, 2048, 1]);
        });

        it('should handle compilation errors correctly', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'bad code' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}); // UPDATE final status

            fs.existsSync.mockReturnValue(true);

            // Mock cp.exec to fail for compilation
            cp.exec.mockImplementationOnce((cmd, cb) => cb({ stderr: 'syntax error' }, null, 'syntax error'));

            await processSubmission(1);

            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE submissions SET overall_status = \'Compilation Error\''), [expect.any(String), 1]);
            expect(judge).not.toHaveBeenCalled();
        });
    });

    describe('processContestSubmission', () => {
        it('should correctly process a basic contest submission', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ problem_id: 'P1', code: 'int main(){}' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE Compiling
                .mockResolvedValueOnce({}) // UPDATE Running
                .mockResolvedValueOnce({}); // UPDATE final results

            fs.existsSync.mockReturnValue(true);

            judge.mockResolvedValueOnce({
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
});
