const path = require('path');
const fs = require('fs');
const { memoryUpload, diskUpload } = require('../../middleware/upload');

// Mock fs to avoid actually creating directories during tests
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
}));

describe('Upload Middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('memoryUpload', () => {
        it('should use memory storage', () => {
            // Memory storage is mostly opaque, but we can verify it was created
            expect(memoryUpload.storage).toBeDefined();
            expect(memoryUpload.storage.constructor.name).toBe('MemoryStorage');
        });
    });

    describe('diskUpload', () => {
        it('should define a disk storage with destination and filename functions', () => {
            expect(diskUpload.storage).toBeDefined();
            expect(diskUpload.storage.getDestination).toBeInstanceOf(Function);
            expect(diskUpload.storage.getFilename).toBeInstanceOf(Function);
        });

        it('should set destination to /tmp/oj_uploads and create directory if it does not exist', () => {
            fs.existsSync.mockReturnValue(false); // Simulate dir not existing

            const req = {};
            const file = {};
            const cb = jest.fn();

            // Invoke the destination function
            diskUpload.storage.getDestination(req, file, cb);

            // Verify fs functions were called
            const expectedPath = path.join('/tmp', 'oj_uploads');
            expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
            expect(fs.mkdirSync).toHaveBeenCalledWith(expectedPath, { recursive: true });

            // Verify callback was called with correct path
            expect(cb).toHaveBeenCalledWith(null, expectedPath);
        });

        it('should set destination without creating directory if it already exists', () => {
            fs.existsSync.mockReturnValue(true); // Simulate dir existing

            const req = {};
            const file = {};
            const cb = jest.fn();

            diskUpload.storage.getDestination(req, file, cb);

            const expectedPath = path.join('/tmp', 'oj_uploads');
            expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
            expect(fs.mkdirSync).not.toHaveBeenCalled();
            expect(cb).toHaveBeenCalledWith(null, expectedPath);
        });

        it('should generate a unique filename retaining original extension', () => {
            const req = {};
            const file = { fieldname: 'testFile', originalname: 'document.pdf' };
            const cb = jest.fn();

            // Mock Date.now and Math.random to verify exact string pattern
            const mockDateNow = 1678886400000;
            const mockRandom = 0.5;
            jest.spyOn(Date, 'now').mockReturnValue(mockDateNow);
            jest.spyOn(Math, 'random').mockReturnValue(mockRandom);

            diskUpload.storage.getFilename(req, file, cb);

            const expectedSuffix = `${mockDateNow}-${Math.round(mockRandom * 1E9)}`;
            const expectedExt = '.pdf';
            const expectedFilename = `testFile-${expectedSuffix}${expectedExt}`;

            expect(cb).toHaveBeenCalledWith(null, expectedFilename);

            // Restore mocks
            Date.now.mockRestore();
            Math.random.mockRestore();
        });
    });
});
