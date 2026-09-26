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

// processProblemDirectory runs inside db.withTransaction, which grabs a client
// via pool.connect(); tests/setup.ts forwards that client's queries to
// db.query, which itself delegates to this same mocked pool.query. The mock
// dispatches on the SQL text so the BEGIN/COMMIT statements never consume the
// per-problem stubs.
const dbQuery = db.pool.query as unknown as jest.Mock;

/** SQL-dispatching DB mock: configure outcomes per statement type per test. */
interface DbMockConfig {
    /** Result of the collection upsert (INSERT INTO collections ... ON CONFLICT). */
    collectionId?: number | null;
    /** rowCount of the problem INSERT (ON CONFLICT DO NOTHING): 1 = new, 0 = existing. */
    problemInsertRowCount?: number;
    /** When set, the statement containing this SQL fragment rejects. */
    failOn?: string;
}
function stubDb(config: DbMockConfig = {}): void {
    const { collectionId = 7, problemInsertRowCount = 1, failOn } = config;
    dbQuery.mockImplementation((sql: string) => {
        if (failOn && sql.includes(failOn)) {
            return Promise.reject(new Error('insert failed'));
        }
        if (sql.includes('INSERT INTO collections')) {
            return Promise.resolve({ rows: collectionId === null ? [] : [{ id: collectionId }] });
        }
        if (sql.includes('INSERT INTO problems')) {
            return Promise.resolve({ rowCount: problemInsertRowCount });
        }
        return Promise.resolve({});
    });
}

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

    // Standard readdir sequence for a batch ZIP whose root contains one
    // problem directory P1: topLevelItems -> itemsInSource -> dirents ->
    // filesInProblemDir. (The first two level-collapse reads mirror a
    // [problemDir] layout where config.json sits one level down.) Any further
    // readdir (e.g. looking for testcase subdirectories) sees an empty dir.
    function stubSingleProblemDirLayout(dirName: string, files: string[]) {
        (fsPromises.readdir as jest.Mock)
            .mockResolvedValueOnce([createMockDirent(dirName, true)])
            .mockResolvedValueOnce([dirName])
            .mockResolvedValueOnce([createMockDirent(dirName, true)])
            .mockResolvedValueOnce(files)
            .mockResolvedValue([]);
    }

    function stubConfig(config: Record<string, unknown>) {
        (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(config));
    }

    describe('processBatchUpload', () => {
        it('should extract zip and process valid problem directories', async () => {
            // Mock unzipper extraction for the main batch zip
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            stubSingleProblemDirLayout('P1', ['config.json', 'statement.pdf', 'testcases.zip']);
            stubConfig({
                id: 'P1',
                title: 'Problem 1',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            });
            (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(Buffer.from('%PDF-1.4 fake')); // Read PDF (valid magic bytes)

            stubDb({ problemInsertRowCount: 1 });

            // Mock unzipper for the testcases zip
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({
                files: [
                    { path: '1.in', stream: () => Buffer.from('in'), type: 'File' },
                    { path: '1.out', stream: () => Buffer.from('out'), type: 'File' }
                ]
            });

            const onProgress = jest.fn();
            const results = await processBatchUpload('/tmp/test.zip', onProgress);

            expect(results.added).toContain('P1');
            expect(results.errors).toHaveLength(0);
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ processed: 1 }));

            // Legacy ZIP (no metadata fields): new problem gets the same
            // defaults as the admin create form — no categories, Unrated,
            // no collection.
            expect(dbQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO problems'),
                ['P1', 'Problem 1', 'Admin', 1000, 256, [], null, null]
            );
            expect(fsPromises.unlink).toHaveBeenCalledWith('/tmp/test.zip');
        });

        it('should persist categories, difficulty, and collection for a new problem', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            stubSingleProblemDirLayout('P1', ['config.json']);
            stubConfig({
                id: 'P1',
                title: 'Problem 1',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256,
                categories: ['Tree', 'Graph', 'Tree'],
                difficulty: 2100,
                collection: ' Chapter 1 '
            });

            stubDb({ collectionId: 7, problemInsertRowCount: 1 });

            const results = await processBatchUpload('/tmp/test.zip');
            expect(results.added).toContain('P1');

            // Collection resolved by name (parameterized, no SQL interpolation),
            // trimmed before lookup.
            expect(dbQuery).toHaveBeenCalledWith(
                expect.stringContaining('ON CONFLICT (name) DO UPDATE'),
                ['Chapter 1'],
            );
            // Insert carries the metadata (categories deduped + sorted)
            expect(dbQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO problems'),
                ['P1', 'Problem 1', 'Admin', 1000, 256, ['Graph', 'Tree'], 2100, 7],
            );
        });

        it('should return skipped status if problem already exists', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            stubSingleProblemDirLayout('P2', ['config.json']);
            stubConfig({
                id: 'P2',
                title: 'Problem 2',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            });

            stubDb({ problemInsertRowCount: 0 });

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.skipped).toContain('P2');
            expect(results.added).not.toContain('P2');
            // The metadata UPDATE for the existing problem still ran.
            expect(dbQuery).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE problems'),
                expect.anything(),
            );
        });

        it('should preserve existing metadata when fields are omitted on a skipped problem', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            stubSingleProblemDirLayout('P2', ['config.json']);
            stubConfig({
                id: 'P2',
                title: 'Problem 2',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
                // categories / difficulty / collection all omitted
            });

            stubDb({ problemInsertRowCount: 0 });

            await processBatchUpload('/tmp/test.zip');

            // All three "provided" flags false -> every CASE keeps the stored value.
            expect(dbQuery).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE problems'),
                ['P2', false, [], false, null, false, null],
            );
        });

        it('should clear existing metadata when fields are explicitly null/empty', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            stubSingleProblemDirLayout('P2', ['config.json']);
            stubConfig({
                id: 'P2',
                title: 'Problem 2',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256,
                categories: null,
                difficulty: null,
                collection: '   '
            });

            stubDb({ problemInsertRowCount: 0 });

            await processBatchUpload('/tmp/test.zip');

            // All three "provided" flags true -> every CASE replaces the value
            // with the (empty) explicit one.
            expect(dbQuery).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE problems'),
                ['P2', true, [], true, null, true, null],
            );
            // No collection was resolved (whitespace-only = clear, not create)
            const collectionCalls = dbQuery.mock.calls.filter(
                ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO collections'),
            );
            expect(collectionCalls).toHaveLength(0);
        });

        it('should reject an unknown category with a per-problem, named error', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            stubSingleProblemDirLayout('tree-dp', ['config.json']);
            stubConfig({
                id: 'tree-dp',
                title: 'Tree DP',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256,
                categories: ['Graphs']
            });

            stubDb();

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.errors).toHaveLength(1);
            expect(results.errors[0].message).toContain('Problem "tree-dp"');
            expect(results.errors[0].message).toContain('Unknown category "Graphs"');
            expect(results.errors[0].message).toContain('Dynamic Programming');
            expect(results.errors[0].directory).toBe('tree-dp');
            // Nothing was persisted
            expect(dbQuery).not.toHaveBeenCalled();
        });

        it('should reject an out-of-scale difficulty with a named error', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            stubSingleProblemDirLayout('P4', ['config.json']);
            stubConfig({
                id: 'P4',
                title: 'Problem 4',
                author: 'Admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256,
                difficulty: 9000
            });

            stubDb();

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.errors).toHaveLength(1);
            expect(results.errors[0].message).toContain('Problem "P4"');
            expect(results.errors[0].message).toContain('difficulty');
            expect(dbQuery).not.toHaveBeenCalled();
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

        it('should report one problem failing without stopping the batch, and roll back its unit', async () => {
            const mockExtract = jest.fn().mockResolvedValue(undefined);
            (unzipper.Open.file as jest.Mock).mockResolvedValueOnce({ extract: mockExtract });

            // Batch root contains two problem directories.
            (fsPromises.readdir as jest.Mock)
                .mockResolvedValueOnce([createMockDirent('PA', true), createMockDirent('PB', true)])
                .mockResolvedValueOnce(['PA', 'PB'])
                .mockResolvedValueOnce([createMockDirent('PA', true), createMockDirent('PB', true)]);

            // First problem (PA): valid config, imports fine.
            (fsPromises.readdir as jest.Mock)
                .mockResolvedValueOnce(['config.json'])       // filesInProblemDir (PA)
                .mockResolvedValueOnce([] as fs.Dirent[]);    // testcase probing (PA)
            stubConfig({ id: 'PA', title: 'A', author: 'X', time_limit_ms: 1000, memory_limit_mb: 256 });
            // Second problem (PB): valid config too, but the DB fails its unit.
            (fsPromises.readdir as jest.Mock).mockResolvedValueOnce(['config.json']); // filesInProblemDir (PB)
            stubConfig({ id: 'PB', title: 'B', author: 'X', time_limit_ms: 1000, memory_limit_mb: 256 });
            // Any further readdir (testcase probing for PB) sees nothing.
            (fsPromises.readdir as jest.Mock).mockResolvedValue([]);

            let problemInsertCount = 0;
            dbQuery.mockImplementation((sql: string) => {
                if (sql.includes('INSERT INTO problems')) {
                    problemInsertCount += 1;
                    // PA imports; PB's insert fails -> whole PB unit rolls back.
                    return problemInsertCount === 1
                        ? Promise.resolve({ rowCount: 1 })
                        : Promise.reject(new Error('insert failed'));
                }
                return Promise.resolve({});
            });

            const results = await processBatchUpload('/tmp/test.zip');

            expect(results.added).toEqual(['PA']);
            expect(results.errors).toHaveLength(1);
            expect(results.errors[0].directory).toBe('PB');
            expect(results.errors[0].message).toContain('insert failed');
            // The failed problem's unit was rolled back (BEGIN...ROLLBACK pair).
            const statements = dbQuery.mock.calls.map(([sql]) => String(sql).trim());
            expect(statements).toContain('ROLLBACK');
            expect(statements).toContain('COMMIT');
        });
    });
});
