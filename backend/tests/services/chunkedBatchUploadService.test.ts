import fs from 'fs';
import path from 'path';
import os from 'os';
import { Writable } from 'stream';

// This test is intentionally added before the service exists. The runtime
// contract below is the one routes will consume in the next implementation
// task; it uses isolated filesystem roots for every test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const chunkedBatchUpload = require('../../services/chunkedBatchUploadService') as typeof import('../../services/chunkedBatchUploadService');

const MIB = 1024 * 1024;
const CHUNK_BYTES = 25 * MIB;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

describe('ChunkedBatchUploadService', () => {
  let root: string;
  let sessionRoot: string;
  let assembledRoot: string;
  let service: InstanceType<typeof chunkedBatchUpload.ChunkedBatchUploadService>;

  const createService = (options: Partial<ConstructorParameters<typeof chunkedBatchUpload.ChunkedBatchUploadService>[0]> = {}) =>
    new chunkedBatchUpload.ChunkedBatchUploadService({ sessionRoot, assembledRoot, ...options });

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chunked-batch-upload-test-'));
    sessionRoot = path.join(root, 'sessions');
    assembledRoot = path.join(root, 'assembled');
    service = createService();
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  async function createUpload(fileSize = CHUNK_BYTES + 3, userId = 17) {
    return service.createSession({
      userId,
      fileName: 'problems.zip',
      fileSize,
      totalChunks: Math.ceil(fileSize / CHUNK_BYTES),
    });
  }

  it('creates a UUID session with private owner-bound metadata', async () => {
    const { uploadId } = await createUpload();
    expect(uploadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const sessionPath = path.join(sessionRoot, uploadId);
    const metadata = JSON.parse(await fs.promises.readFile(path.join(sessionPath, 'metadata.json'), 'utf8'));
    expect(metadata).toMatchObject({ ownerId: 17, fileName: 'problems.zip', fileSize: CHUNK_BYTES + 3, totalChunks: 2 });
    expect((await fs.promises.stat(sessionPath)).mode & 0o077).toBe(0);
  });

  it('tightens an existing session root to private permissions when supported', async () => {
    await fs.promises.mkdir(sessionRoot, { recursive: true, mode: 0o755 });
    await fs.promises.chmod(sessionRoot, 0o755);
    await createUpload();

    expect((await fs.promises.stat(sessionRoot)).mode & 0o077).toBe(0);
  });

  it('accepts only the expected 25 MiB chunk and final remainder from its owner', async () => {
    const { uploadId } = await createUpload();
    await expect(service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES - 1) }))
      .rejects.toMatchObject({ statusCode: 400 });
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES, 1) });
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 1, data: Buffer.from('end') });
    expect(await fs.promises.stat(path.join(sessionRoot, uploadId, '1.part'))).toMatchObject({ size: 3 });
  });

  it('rejects an owner mismatch and indexes outside the declared range', async () => {
    const { uploadId } = await createUpload();
    await expect(service.writeChunk({ uploadId, userId: 18, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES) }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(service.writeChunk({ uploadId, userId: 17, chunkIndex: 2, data: Buffer.alloc(CHUNK_BYTES) }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('keeps a same-content retry idempotent but rejects a conflicting retry', async () => {
    const { uploadId } = await createUpload();
    const first = Buffer.alloc(CHUNK_BYTES, 7);
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: first });
    await expect(service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.from(first) })).resolves.toMatchObject({ idempotent: true });
    await expect(service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES, 8) }))
      .rejects.toMatchObject({ statusCode: 409 });
    const part = await fs.promises.open(path.join(sessionRoot, uploadId, '0.part'), 'r');
    const firstByte = Buffer.alloc(1);
    await part.read(firstByte, 0, 1, 0);
    await part.close();
    expect(firstByte).toEqual(Buffer.from([7]));
    expect((await fs.promises.stat(path.join(sessionRoot, uploadId, '0.part'))).size).toBe(CHUNK_BYTES);
  });

  it('refuses assembly while any declared chunk is missing', async () => {
    const { uploadId } = await createUpload();
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES, 1) });
    await expect(service.assemble({ uploadId, userId: 17 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(fs.promises.access(path.join(assembledRoot, `oj-batch-${uploadId}.zip`))).rejects.toThrow();
  });

  it('streams chunks in index order and verifies the assembled byte count', async () => {
    const { uploadId } = await createUpload();
    const first = Buffer.alloc(CHUNK_BYTES, 0x61);
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 1, data: Buffer.from('xyz') });
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: first });

    const { zipPath } = await service.assemble({ uploadId, userId: 17 });
    const archive = await fs.promises.open(zipPath, 'r');
    const start = Buffer.alloc(3);
    const end = Buffer.alloc(3);
    await archive.read(start, 0, 3, 0);
    await archive.read(end, 0, 3, CHUNK_BYTES);
    await archive.close();
    expect(start).toEqual(Buffer.from('aaa'));
    expect(end).toEqual(Buffer.from('xyz'));
    expect((await fs.promises.stat(zipPath)).size).toBe(CHUNK_BYTES + 3);
    await expect(fs.promises.access(path.join(sessionRoot, uploadId))).rejects.toThrow();
  });

  it('removes a partial assembled archive when streaming assembly fails', async () => {
    const { uploadId } = await createUpload();
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES, 1) });
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 1, data: Buffer.from('end') });
    let wrotePartialArchive = false;
    const failing = createService({
      createOutputStream: (outputPath) => new Writable({
        write(chunk, _encoding, callback) {
          fs.promises.writeFile(outputPath, chunk, { flag: wrotePartialArchive ? 'a' : 'w' })
            .then(() => {
              wrotePartialArchive = true;
              callback(new Error('disk write failed'));
            }, callback);
        },
      }),
    });

    await expect(failing.assemble({ uploadId, userId: 17 })).rejects.toThrow('disk write failed');
    expect(wrotePartialArchive).toBe(true);
    await expect(fs.promises.access(path.join(assembledRoot, `oj-batch-${uploadId}.zip`))).rejects.toThrow();
    expect(await fs.promises.readdir(assembledRoot)).toEqual([]);
    await expect(fs.promises.access(path.join(sessionRoot, uploadId))).resolves.toBeUndefined();
  });

  it('removes its temporary archive when output stream setup fails synchronously', async () => {
    const { uploadId } = await createUpload();
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES, 1) });
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 1, data: Buffer.from('end') });
    const failing = createService({
      createOutputStream: (outputPath) => {
        fs.writeFileSync(outputPath, 'partial');
        throw new Error('stream setup failed');
      },
    });

    await expect(failing.assemble({ uploadId, userId: 17 })).rejects.toThrow('stream setup failed');
    expect(await fs.promises.readdir(assembledRoot)).toEqual([]);
    await expect(fs.promises.access(path.join(sessionRoot, uploadId))).resolves.toBeUndefined();
  });

  it('publishes one concurrent assembly without deleting another attempt output', async () => {
    const { uploadId } = await createUpload();
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 0, data: Buffer.alloc(CHUNK_BYTES, 1) });
    await service.writeChunk({ uploadId, userId: 17, chunkIndex: 1, data: Buffer.from('end') });

    let releaseFirstWrite: (() => void) | undefined;
    let notifyFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => { notifyFirstWrite = resolve; });
    let firstOutputPath: string | undefined;
    let secondOutputPath: string | undefined;
    let writes = 0;
    const firstService = createService({
      createOutputStream: (outputPath) => new Writable({
        construct(callback) {
          firstOutputPath = outputPath;
          callback();
        },
        write(chunk, _encoding, callback) {
          fs.promises.writeFile(outputPath, chunk, { flag: writes++ === 0 ? 'w' : 'a' })
            .then(() => {
              if (writes === 1) {
                notifyFirstWrite?.();
                releaseFirstWrite = () => callback();
                return;
              }
              callback();
            }, callback);
        },
      }),
    });
    const firstAssembly = firstService.assemble({ uploadId, userId: 17 });

    await firstWriteStarted;
    const first = createService({
      createOutputStream: (outputPath) => {
        secondOutputPath = outputPath;
        const error = Object.assign(new Error('exclusive output already exists'), { code: 'EEXIST' });
        return new Writable({ write(_chunk, _encoding, callback) { callback(error); } });
      },
    });
    const secondAssembly = first.assemble({ uploadId, userId: 17 });

    await expect(secondAssembly).rejects.toMatchObject({ code: 'EEXIST' });
    expect(secondOutputPath).not.toBe(firstOutputPath);
    expect(releaseFirstWrite).toBeDefined();
    releaseFirstWrite?.();
    await expect(firstAssembly).resolves.toMatchObject({ zipPath: expect.any(String) });

    const zipPath = path.join(assembledRoot, `oj-batch-${uploadId}.zip`);
    await expect(fs.promises.access(zipPath)).resolves.toBeUndefined();
  });

  it('removes stale chunk sessions and assembled archives after two hours', async () => {
    const fixedNow = new Date('2026-09-29T12:00:00.000Z').getTime();
    service = createService({ now: () => fixedNow });
    const staleSession = path.join(sessionRoot, 'a0f53660-04ea-4ae9-9b78-80646a9bf115');
    await fs.promises.mkdir(staleSession, { recursive: true });
    await fs.promises.writeFile(path.join(staleSession, 'metadata.json'), '{}');
    await fs.promises.mkdir(assembledRoot, { recursive: true });
    const staleArchive = path.join(assembledRoot, 'oj-batch-deadbeef.zip');
    await fs.promises.writeFile(staleArchive, 'old');
    const old = new Date(fixedNow - TWO_HOURS_MS - 1);
    await fs.promises.utimes(staleSession, old, old);
    await fs.promises.utimes(staleArchive, old, old);

    await service.cleanupExpired();
    await expect(fs.promises.access(staleSession)).rejects.toThrow();
    await expect(fs.promises.access(staleArchive)).rejects.toThrow();
  });

  it('continues creating a session when a listed stale session disappears before stat', async () => {
    const fixedNow = new Date('2026-09-29T12:00:00.000Z').getTime();
    service = createService({ now: () => fixedNow });
    const staleSession = path.join(sessionRoot, 'a0f53660-04ea-4ae9-9b78-80646a9bf115');
    await fs.promises.mkdir(staleSession, { recursive: true });
    const old = new Date(fixedNow - TWO_HOURS_MS - 1);
    await fs.promises.utimes(staleSession, old, old);

    const originalReaddir = fs.promises.readdir.bind(fs.promises);
    const readdirSpy = jest.spyOn(fs.promises, 'readdir').mockImplementation(async (directory, options) => {
      const entries = await originalReaddir(directory, options as any);
      if (directory === sessionRoot) {
        await fs.promises.rm(staleSession, { recursive: true, force: true });
      }
      return entries as any;
    });

    try {
      const { uploadId } = await createUpload(3);
      await expect(fs.promises.access(path.join(sessionRoot, uploadId))).resolves.toBeUndefined();
    } finally {
      readdirSpy.mockRestore();
    }
  });
});
