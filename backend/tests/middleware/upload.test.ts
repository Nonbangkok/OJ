import { diskUpload, submissionFormUpload, userAvatarUpload } from '../../middleware/upload';
import { privateTempDir } from '../../utils/privateTemp';
import { SUBMISSION_VALIDATION, USER_AVATAR } from '../../constants';
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

    // The two in-memory instances a regular user account reaches. Busboy
    // holds text fields in RAM, so neither may keep multer's defaults
    // (unlimited fields of up to 1 MB each).
    describe('user-reachable in-memory uploads', () => {
        it('caps the submission form to the schema fields, no files, and the code byte cap', () => {
            expect((submissionFormUpload as any).storage.constructor.name).toBe('MemoryStorage');
            expect((submissionFormUpload as any).limits).toEqual({
                files: 0,
                fields: 4,
                parts: 4,
                fieldSize: 3 * SUBMISSION_VALIDATION.MAX_CODE_LENGTH,
            });
        });

        it('caps the avatar upload to one image file and no text fields', () => {
            expect((userAvatarUpload as any).storage.constructor.name).toBe('MemoryStorage');
            expect((userAvatarUpload as any).limits).toEqual({
                fileSize: USER_AVATAR.MAX_UPLOAD_BYTES,
                files: 1,
                fields: 0,
                parts: 1,
            });
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
