import { processBatchUpload } from '../../services/batchUploadService';
import * as db from '../../db';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import unzipper from 'unzipper';
jest.mock('unzipper');
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, cb) => cb && cb(null, { stdout: '', stderr: '' }))
}));

// Mock fs and fsPromises properly
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        promises: {
            mkdir: jest.fn(),
            readdir: jest.fn(),
            readFile: jest.fn(),
            stat: jest.fn(),
            unlink: jest.fn(),
            rm: jest.fn()
        },
    };
});

jest.spyOn(console, 'error').mockImplementation(() => { });
jest.spyOn(console, 'warn').mockImplementation(() => { });

describe('Batch Upload Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset all mock implementations to prevent test interference
        (fsPromises.readdir as jest.Mock).mockReset();
        (fsPromises.readFile as jest.Mock).mockReset();
        (unzipper.Open.file as jest.Mock).mockReset();
    });

    // Helper function to create mock directory entries that properly implements fs.Dirent interface
    function createMockDirent(name: string, isDir: boolean) {
        const dirent = {
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isSymbolicLink: () => false,
            isFIFO: () => false,
            isSocket: () => false
        } as fs.Dirent;
        return dirent;
    }

    describe('processBatchUpload', () => {
        it('should extract zip and process valid problem directories', async () => {
            // Mock unzipper extraction for the main batch zip
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            // 1. Mock topLevelItems (readdir withFileTypes: true)
            (fsPromises.readdir as jest.Mock).mockResolvedValueOnce([createMockDirent('P1', true)]);
            // 2. Mock itemsInSource (readdir without withFileTypes)
            (fsPromises.readdir as jest.Mock).mockResolvedValueOnce(['P1']);
            // 3. Mock dirents (readdir withFileTypes: true)
            (fsPromises.readdir as jest.Mock).mockResolvedValueOnce([createMockDirent('P1', true)]);
            // 4. Mock filesInProblemDir inside processProblemDirectory (readdir without withFileTypes)
            (fsPromises.readdir as jest.Mock).mockResolvedValueOnce(['config.json', 'statement.pdf', 'testcases.zip']);

            // Mock config.json reading
            const mockConfig = JSON.stringify({
                id: 'P1',
                title: 'Problem 1',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            });
            (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(mockConfig); // Read config
            (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(Buffer.from('%PDF-1.4 fake')); // Read PDF (valid magic bytes)

            // Mock DB insertion of new problem
            (db.pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 }); // Insert Problem
            (db.pool.query as jest.Mock).mockResolvedValueOnce({}); // Update PDF
            (db.pool.query as jest.Mock).mockResolvedValueOnce({}); // Delete old testcases

            // Mock unzipper for the testcases zip
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({
                files: [
                    { path: '1.in', stream: () => Buffer.from('in'), type: 'File' },
                    { path: '1.out', stream: () => Buffer.from('out'), type: 'File' }
                ]
            });

            // Insert testcase into DB
            (db.pool.query as jest.Mock).mockResolvedValueOnce({});

            const onProgress = jest.fn();
            const results = await processBatchUpload('/tmp/test.zip', onProgress);

            expect(results.added).toContain('P1');
            expect(results.errors).toHaveLength(0);
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ processed: 1 }));

            expect(db.pool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO problems'),
                ['P1', 'Problem 1', 'Admin', 1000, 256]
            );
            expect(fsPromises.unlink).toHaveBeenCalledWith('/tmp/test.zip');
        });

        it('should return skipped status if problem already exists', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            (fsPromises.readdir as jest.Mock)
                .mockResolvedValueOnce([createMockDirent('P2', true)])
                .mockResolvedValueOnce(['P2'])
                .mockResolvedValueOnce([createMockDirent('P2', true)]);

            (fsPromises.readdir as jest.Mock).mockResolvedValueOnce(['config.json']);

            const mockConfig = JSON.stringify({
                id: 'P2',
                title: 'Problem 2',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            });
            (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(mockConfig);

            // Mock DB insertion returning 0 rowCount (ON CONFLICT DO NOTHING)
            (db.pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 0 });

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.skipped).toContain('P2');
            expect(results.added).not.toContain('P2');
        });

        it('should handle config.json error gracefully', async () => {
            // Reset all mocks for this specific test
            jest.clearAllMocks();
            
            // Mock unzipper extraction for the main batch zip
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            // Track the call order for readdir
            let readdirCallCount = 0;
            (fsPromises.readdir as jest.Mock).mockImplementation((path: string, options?: any) => {
                readdirCallCount++;
                
                if (readdirCallCount === 1) {
                    return Promise.resolve([createMockDirent('P3', true)]);
                } else if (readdirCallCount === 2) {
                    return Promise.resolve(['config.json']);
                } else if (readdirCallCount === 3) {
                    return Promise.resolve(['config.json']);
                }
                
                // Default fallback
                return Promise.resolve([]);
            });

            // Mock config.json reading to fail - use mockRejectedValueOnce for cleaner error handling
            (fsPromises.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.errors).toHaveLength(1);
            expect(results.errors[0].message).toContain('Cannot read or parse config.json');
            expect(results.errors[0].directory).toBe('P3');
        });
    });
});
