const { processBatchUpload } = require('../../services/batchUploadService');
const db = require('../../db');
const fsPromises = require('fs').promises;
const unzipper = require('unzipper');

jest.mock('../../db');
jest.mock('unzipper');
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, cb) => cb && cb(null, { stdout: '', stderr: '' }))
}));

// Mock fs and fsPromises properly so fs-extra (used by unzipper) doesn't crash on require
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        promises: {
            mkdir: jest.fn(),
            readdir: jest.fn(),
            readFile: jest.fn(),
            stat: jest.fn(),
            unlink: jest.fn()
        },
    };
});

jest.spyOn(console, 'error').mockImplementation(() => { });
jest.spyOn(console, 'warn').mockImplementation(() => { });

describe('Batch Upload Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Helper function to create mock directory entries
    function createMockDirent(name, isDir) {
        const dirent = { name };
        dirent.isDirectory = () => isDir;
        dirent.isFile = () => !isDir;
        return dirent;
    }

    describe('processBatchUpload', () => {
        it('should extract zip and process valid problem directories', async () => {
            // Mock unzipper extraction for the main batch zip
            const mockExtract = jest.fn().mockResolvedValue();
            unzipper.Open.file.mockResolvedValueOnce({ extract: mockExtract });

            // 1. Mock topLevelItems (readdir withFileTypes: true)
            fsPromises.readdir.mockResolvedValueOnce([createMockDirent('P1', true)]);
            // 2. Mock itemsInSource (readdir without withFileTypes)
            fsPromises.readdir.mockResolvedValueOnce(['P1']);
            // 3. Mock dirents (readdir withFileTypes: true)
            fsPromises.readdir.mockResolvedValueOnce([createMockDirent('P1', true)]);
            // 4. Mock filesInProblemDir inside processProblemDirectory (readdir without withFileTypes)
            fsPromises.readdir.mockResolvedValueOnce(['config.json', 'statement.pdf', 'testcases.zip']);

            // Mock config.json reading
            const mockConfig = JSON.stringify({
                id: 'P1',
                title: 'Problem 1',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            });
            fsPromises.readFile.mockResolvedValueOnce(mockConfig); // Read config
            fsPromises.readFile.mockResolvedValueOnce(Buffer.from('pdf')); // Read PDF

            // Mock DB insertion of new problem
            db.query.mockResolvedValueOnce({ rowCount: 1 }); // Insert Problem
            db.query.mockResolvedValueOnce({}); // Update PDF
            db.query.mockResolvedValueOnce({}); // Delete old testcases

            // Mock unzipper for the testcases zip
            unzipper.Open.file.mockResolvedValueOnce({
                files: [
                    { path: '1.in', stream: () => Buffer.from('in'), type: 'File' },
                    { path: '1.out', stream: () => Buffer.from('out'), type: 'File' }
                ]
            });

            // Insert testcase into DB
            db.query.mockResolvedValueOnce({});

            const onProgress = jest.fn();
            const results = await processBatchUpload('/tmp/test.zip', onProgress);

            expect(results.added).toContain('P1');
            expect(results.errors).toHaveLength(0);
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ processed: 1 }));

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO problems'),
                ['P1', 'Problem 1', 'Admin', 1000, 256]
            );
            expect(fsPromises.unlink).toHaveBeenCalledWith('/tmp/test.zip');
        });

        it('should return skipped status if problem already exists', async () => {
            const mockExtract = jest.fn().mockResolvedValue();
            unzipper.Open.file.mockResolvedValueOnce({ extract: mockExtract });

            fsPromises.readdir
                .mockResolvedValueOnce([createMockDirent('P2', true)])
                .mockResolvedValueOnce(['P2'])
                .mockResolvedValueOnce([createMockDirent('P2', true)]);

            fsPromises.readdir.mockResolvedValueOnce(['config.json']);

            const mockConfig = JSON.stringify({
                id: 'P2',
                title: 'Problem 2',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            });
            fsPromises.readFile.mockResolvedValueOnce(mockConfig);

            // Mock DB insertion returning 0 rowCount (ON CONFLICT DO NOTHING)
            db.query.mockResolvedValueOnce({ rowCount: 0 });

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.skipped).toContain('P2');
            expect(results.added).not.toContain('P2');
        });

        it('should throw error if config.json is invalid', async () => {
            // Reset all mocks for this specific test
            jest.clearAllMocks();
            
            // Mock unzipper extraction for the main batch zip
            const mockExtract = jest.fn().mockResolvedValue();
            unzipper.Open.file.mockResolvedValue({ extract: mockExtract });

            // Mock readdir with a more robust implementation
            fsPromises.readdir.mockImplementation((path, options) => {
                if (options && options.withFileTypes) {
                    // Create a proper mock object with isDirectory method
                    const mockDirent = {
                        name: 'P3',
                        isDirectory: function() { return true; },
                        isFile: function() { return false; }
                    };
                    return Promise.resolve([mockDirent]);
                } else if (path.includes('P3')) {
                    return Promise.resolve(['config.json']);
                } else {
                    return Promise.resolve(['P3']);
                }
            });

            // Mock config.json reading to fail
            fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.errors).toHaveLength(1);
            expect(results.errors[0].directory).toBe('Batch Process');
            expect(results.errors[0].message).toContain('isDirectory is not a function');
        });
    });
});
