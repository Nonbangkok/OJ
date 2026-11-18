import { memoryUpload, diskUpload } from '../../middleware/upload';
import { privateTempDir } from '../../utils/privateTemp';
import { Request } from 'express';

// Disk uploads are staged in a private directory of the backend work root.
jest.mock('../../utils/privateTemp', () => ({
    privateTempDir: jest.fn(),
}));

/** Run multer's destination callback and resolve with what it reported. */
function destinationOf(storage: { getDestination: Function }): Promise<[unknown, unknown]> {
    return new Promise((resolve) => {
        storage.getDestination({} as Request, {} as any, (error: unknown, destination: unknown) => resolve([error, destination]));
    });
}

describe('Upload Middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('memoryUpload', () => {
        it('should use memory storage', () => {
            // Memory storage is mostly opaque, but we can verify it was created
            expect((memoryUpload as any).storage).toBeDefined();
            expect((memoryUpload as any).storage.constructor.name).toBe('MemoryStorage');
        });
    });

    describe('diskUpload', () => {
        it('should define a disk storage with destination and filename functions', () => {
            expect((diskUpload as any).storage).toBeDefined();
            const storage = (diskUpload as any).storage;
            expect(storage.getDestination).toBeInstanceOf(Function);
            expect(storage.getFilename).toBeInstanceOf(Function);
        });

        it('stages uploads in one private work-root directory, created once', async () => {
            (privateTempDir as jest.Mock).mockResolvedValue('/work/oj-work-1-abcdef/uploads-123456');
            const storage = (diskUpload as any).storage;

            await expect(destinationOf(storage)).resolves.toEqual([null, '/work/oj-work-1-abcdef/uploads-123456']);
            await expect(destinationOf(storage)).resolves.toEqual([null, '/work/oj-work-1-abcdef/uploads-123456']);

            expect(privateTempDir).toHaveBeenCalledTimes(1);
            expect(privateTempDir).toHaveBeenCalledWith('uploads-');
        });

        it('fails the upload when the private directory cannot be made, and retries on the next one', async () => {
            await jest.isolateModulesAsync(async () => {
                const isolatedTemp = jest.requireMock('../../utils/privateTemp') as { privateTempDir: jest.Mock };
                const { diskUpload: isolatedUpload } = jest.requireActual('../../middleware/upload') as typeof import('../../middleware/upload');
                isolatedTemp.privateTempDir
                    .mockRejectedValueOnce(new Error('work root is not private'))
                    .mockResolvedValueOnce('/work/uploads-2');
                const storage = (isolatedUpload as any).storage;

                const [error] = await destinationOf(storage);
                expect(error).toEqual(new Error('work root is not private'));
                await expect(destinationOf(storage)).resolves.toEqual([null, '/work/uploads-2']);
            });
        });

        it('should generate a unique filename retaining original extension', () => {
            const req = {} as Request;
            const file = { fieldname: 'testFile', originalname: 'document.pdf' } as any;
            const cb = jest.fn();

            // Mock Date.now and Math.random to verify exact string pattern
            const mockDateNow = 1678886400000;
            const mockRandom = 0.5;
            jest.spyOn(Date, 'now').mockReturnValue(mockDateNow);
            jest.spyOn(Math, 'random').mockReturnValue(mockRandom);

            const storage = (diskUpload as any).storage;
            storage.getFilename(req, file, cb);

            const expectedSuffix = `${mockDateNow}-${Math.round(mockRandom * 1E9)}`;
            const expectedExt = '.pdf';
            const expectedFilename = `testFile-${expectedSuffix}${expectedExt}`;

            expect(cb).toHaveBeenCalledWith(null, expectedFilename);

            // Restore mocks
            (Date.now as jest.Mock).mockRestore();
            (Math.random as jest.Mock).mockRestore();
        });
    });
});
