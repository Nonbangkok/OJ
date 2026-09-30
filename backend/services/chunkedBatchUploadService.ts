import { createReadStream, createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID, timingSafeEqual } from 'crypto';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';
import {
  CHUNKED_BATCH_UPLOAD_CHUNK_BYTES as schemaChunkBytes,
  CHUNKED_BATCH_UPLOAD_MAX_FILE_BYTES as schemaMaxFileBytes,
  chunkedBatchUploadInitSchema,
} from '../schemas/requestSchemas';
import { AppError } from '../middleware/errorHandler';

export const CHUNKED_BATCH_UPLOAD_CHUNK_BYTES = schemaChunkBytes;
export const CHUNKED_BATCH_UPLOAD_MAX_FILE_BYTES = schemaMaxFileBytes;
export const CHUNKED_BATCH_UPLOAD_MULTER_FILE_SIZE_BYTES = 35 * 1024 * 1024;
export const CHUNKED_BATCH_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

const SESSION_DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const metadataFileName = 'metadata.json';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ChunkedBatchUploadMetadata {
  ownerId: number;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  createdAt: number;
  purpose?: 'batch' | 'problem-testcases';
  problemId?: string;
}

export interface CreateChunkedBatchUploadSessionInput {
  userId: number;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  purpose?: 'batch' | 'problem-testcases';
  problemId?: string;
}

export interface WriteChunkInput {
  uploadId: string;
  userId: number;
  chunkIndex: number;
  data: Buffer;
}

export interface AssembleChunkedBatchUploadInput {
  uploadId: string;
  userId: number;
}

export interface ChunkedBatchUploadServiceOptions {
  /** Root for session directories; defaults to /tmp/oj-chunk-uploads. */
  sessionRoot?: string;
  /** Root for assembled ZIPs; defaults to /tmp. */
  assembledRoot?: string;
  /** Injected clock keeps expiry tests deterministic. */
  now?: () => number;
  /** Injected only for deterministic filesystem-output failure testing. */
  createOutputStream?: (zipPath: string) => Writable;
}

/**
 * Keeps an authenticated, chunked batch ZIP upload entirely on this backend
 * instance until it can be handed to the existing batch-upload processor.
 */
export class ChunkedBatchUploadService {
  private readonly sessionRoot: string;
  private readonly assembledRoot: string;
  private readonly now: () => number;
  private readonly outputStreamFactory: (zipPath: string) => Writable;

  constructor(options: ChunkedBatchUploadServiceOptions = {}) {
    this.sessionRoot = options.sessionRoot ?? path.join(os.tmpdir(), 'oj-chunk-uploads');
    this.assembledRoot = options.assembledRoot ?? os.tmpdir();
    this.now = options.now ?? Date.now;
    this.outputStreamFactory = options.createOutputStream
      ?? ((zipPath) => createWriteStream(zipPath, { flags: 'wx', mode: FILE_MODE }));
  }

  async createSession(input: CreateChunkedBatchUploadSessionInput): Promise<{ uploadId: string }> {
    if (!Number.isInteger(input.userId) || input.userId <= 0) {
      throw new AppError('A valid upload owner is required.', 400);
    }
    const parsed = chunkedBatchUploadInitSchema.safeParse({
      fileName: input.fileName,
      fileSize: input.fileSize,
      totalChunks: input.totalChunks,
    });
    if (!parsed.success) {
      throw new AppError('Invalid chunked batch upload session.', 400, parsed.error.issues);
    }
    const purpose = input.purpose ?? 'batch';
    if ((purpose === 'problem-testcases' && !input.problemId)
      || (purpose === 'batch' && input.problemId !== undefined)) {
      throw new AppError('Invalid chunked upload target.', 400);
    }

    await this.cleanupExpired();
    await fs.mkdir(this.sessionRoot, { recursive: true, mode: SESSION_DIRECTORY_MODE });
    await this.restrictDirectoryPermissions(this.sessionRoot);

    const uploadId = randomUUID();
    const sessionPath = this.sessionPath(uploadId);
    const metadata: ChunkedBatchUploadMetadata = {
      ownerId: input.userId,
      ...parsed.data,
      createdAt: this.now(),
      purpose,
      ...(purpose === 'problem-testcases' ? { problemId: input.problemId } : {}),
    };

    try {
      await fs.mkdir(sessionPath, { mode: SESSION_DIRECTORY_MODE });
      await this.restrictDirectoryPermissions(sessionPath);
      await this.writeFileAtomically(path.join(sessionPath, metadataFileName), Buffer.from(JSON.stringify(metadata)));
    } catch (error) {
      await fs.rm(sessionPath, { recursive: true, force: true });
      throw error;
    }

    return { uploadId };
  }

  async writeChunk(input: WriteChunkInput): Promise<{ idempotent: boolean }> {
    const { sessionPath, metadata } = await this.loadOwnedSession(input.uploadId, input.userId);
    if (!Number.isInteger(input.chunkIndex) || input.chunkIndex < 0 || input.chunkIndex >= metadata.totalChunks) {
      throw new AppError('Chunk index is outside this upload session.', 400);
    }
    if (!Buffer.isBuffer(input.data)) {
      throw new AppError('Chunk data is required.', 400);
    }
    if (input.data.byteLength !== this.expectedChunkSize(metadata, input.chunkIndex)) {
      throw new AppError('Chunk size does not match the upload session.', 400);
    }

    const partPath = path.join(sessionPath, `${input.chunkIndex}.part`);
    try {
      const existing = await fs.readFile(partPath);
      if (existing.byteLength === input.data.byteLength && timingSafeEqual(existing, input.data)) {
        await this.touchSession(sessionPath);
        return { idempotent: true };
      }
      throw new AppError('A different chunk already exists at this index.', 409);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const temporaryPartPath = path.join(sessionPath, `.${input.chunkIndex}.${randomUUID()}.part`);
    try {
      await fs.writeFile(temporaryPartPath, input.data, { flag: 'wx', mode: FILE_MODE });
      try {
        // link is an atomic create-if-absent operation, so concurrent retries
        // cannot replace a part that another request has already completed.
        await fs.link(temporaryPartPath, partPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await fs.readFile(partPath);
        if (existing.byteLength === input.data.byteLength && timingSafeEqual(existing, input.data)) {
          await this.touchSession(sessionPath);
          return { idempotent: true };
        }
        throw new AppError('A different chunk already exists at this index.', 409);
      }
      await this.touchSession(sessionPath);
      return { idempotent: false };
    } finally {
      await fs.rm(temporaryPartPath, { force: true });
    }
  }

  async assemble(input: AssembleChunkedBatchUploadInput): Promise<{ zipPath: string }> {
    const { sessionPath, metadata } = await this.loadOwnedSession(input.uploadId, input.userId);
    if ((metadata.purpose ?? 'batch') !== 'batch') {
      throw new AppError('Upload session is not a batch upload.', 400);
    }
    return this.assembleSession(sessionPath, metadata, input.uploadId, 'oj-batch');
  }

  async assembleProblemTestcases(input: AssembleChunkedBatchUploadInput & { problemId: string }): Promise<{ zipPath: string }> {
    const { sessionPath, metadata } = await this.loadOwnedSession(input.uploadId, input.userId);
    if (metadata.purpose !== 'problem-testcases' || metadata.problemId !== input.problemId) {
      throw new AppError('Upload session does not belong to this problem.', 403);
    }
    return this.assembleSession(sessionPath, metadata, input.uploadId, 'oj-testcases');
  }

  private async assembleSession(
    sessionPath: string,
    metadata: ChunkedBatchUploadMetadata,
    uploadId: string,
    archivePrefix: 'oj-batch' | 'oj-testcases',
  ): Promise<{ zipPath: string }> {
    const partPaths: string[] = [];

    for (let chunkIndex = 0; chunkIndex < metadata.totalChunks; chunkIndex += 1) {
      const partPath = path.join(sessionPath, `${chunkIndex}.part`);
      let partStats;
      try {
        partStats = await fs.stat(partPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new AppError(`Chunk ${chunkIndex} is missing.`, 400);
        }
        throw error;
      }
      if (!partStats.isFile() || partStats.size !== this.expectedChunkSize(metadata, chunkIndex)) {
        throw new AppError(`Chunk ${chunkIndex} has an invalid size.`, 400);
      }
      partPaths.push(partPath);
    }

    await fs.mkdir(this.assembledRoot, { recursive: true, mode: SESSION_DIRECTORY_MODE });
    const zipPath = path.join(this.assembledRoot, `${archivePrefix}-${uploadId}.zip`);
    // Assemble to an attempt-local file. A concurrent request must never be
    // able to remove or replace another request's in-progress/final archive.
    // Keeping the .zip suffix also lets the existing two-hour cleanup collect
    // a temporary file left behind by an interrupted process.
    const temporaryZipPath = path.join(this.assembledRoot, `${archivePrefix}-${uploadId}.${randomUUID()}.zip`);

    try {
      const output = this.outputStreamFactory(temporaryZipPath);
      for (const partPath of partPaths) {
        await pipeline(createReadStream(partPath), output, { end: false });
      }
      await new Promise<void>((resolve, reject) => {
        output.once('error', reject);
        output.once('finish', resolve);
        output.end();
      });

      const assembled = await fs.stat(temporaryZipPath);
      if (assembled.size !== metadata.fileSize) {
        throw new AppError('Assembled ZIP byte count does not match the upload session.', 500);
      }
      // link creates the final name atomically without replacing an archive
      // published by another concurrent completion attempt.
      await fs.link(temporaryZipPath, zipPath);
      await fs.rm(temporaryZipPath, { force: true });
    } catch (error) {
      await fs.rm(temporaryZipPath, { force: true });
      throw error;
    }

    await fs.rm(sessionPath, { recursive: true, force: true });
    return { zipPath };
  }

  async cleanupExpired(): Promise<void> {
    const expiredBefore = this.now() - CHUNKED_BATCH_UPLOAD_TTL_MS;
    await this.removeOldEntries(this.sessionRoot, expiredBefore, (entry) => entry.isDirectory());
    await this.removeOldEntries(this.assembledRoot, expiredBefore,
      (entry) => entry.isFile() && /^oj-(?:batch|testcases)-.+\.zip$/.test(entry.name));
  }

  private async removeOldEntries(
    root: string,
    expiredBefore: number,
    shouldRemove: (entry: import('fs').Dirent) => boolean,
  ): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    await Promise.all(entries.map(async (entry) => {
      if (!shouldRemove(entry)) return;
      const entryPath = path.join(root, entry.name);
      let stats;
      try {
        stats = await fs.stat(entryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      if (stats.mtimeMs < expiredBefore) {
        await fs.rm(entryPath, { recursive: entry.isDirectory(), force: true });
      }
    }));
  }

  private async loadOwnedSession(uploadId: string, userId: number): Promise<{ sessionPath: string; metadata: ChunkedBatchUploadMetadata }> {
    const sessionPath = this.sessionPath(uploadId);
    let rawMetadata: string;
    try {
      rawMetadata = await fs.readFile(path.join(sessionPath, metadataFileName), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('Upload session not found.', 404);
      }
      throw error;
    }

    let metadata: unknown;
    try {
      metadata = JSON.parse(rawMetadata);
    } catch {
      throw new AppError('Upload session metadata is invalid.', 500);
    }
    if (!this.isValidMetadata(metadata)) {
      throw new AppError('Upload session metadata is invalid.', 500);
    }
    if (metadata.ownerId !== userId) {
      throw new AppError('Upload session belongs to another user.', 403);
    }
    return { sessionPath, metadata };
  }

  private sessionPath(uploadId: string): string {
    if (!uuidPattern.test(uploadId)) {
      throw new AppError('Upload session ID is invalid.', 400);
    }
    return path.join(this.sessionRoot, uploadId);
  }

  private expectedChunkSize(metadata: ChunkedBatchUploadMetadata, chunkIndex: number): number {
    if (chunkIndex < metadata.totalChunks - 1) return CHUNKED_BATCH_UPLOAD_CHUNK_BYTES;
    return metadata.fileSize - CHUNKED_BATCH_UPLOAD_CHUNK_BYTES * (metadata.totalChunks - 1);
  }

  private async touchSession(sessionPath: string): Promise<void> {
    const now = new Date(this.now());
    await fs.utimes(sessionPath, now, now);
  }

  private async restrictDirectoryPermissions(directory: string): Promise<void> {
    try {
      await fs.chmod(directory, SESSION_DIRECTORY_MODE);
    } catch (error) {
      // Some filesystems (notably Windows volume mounts) do not expose POSIX
      // modes. On platforms that do, chmod failures must still surface.
      if (['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }
  }

  private async writeFileAtomically(filePath: string, content: Buffer): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, content, { flag: 'wx', mode: FILE_MODE });
      await fs.rename(temporaryPath, filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }

  private isValidMetadata(value: unknown): value is ChunkedBatchUploadMetadata {
    if (typeof value !== 'object' || value === null) return false;
    const metadata = value as Partial<ChunkedBatchUploadMetadata>;
    return Number.isInteger(metadata.ownerId)
      && (metadata.ownerId as number) > 0
      && typeof metadata.fileName === 'string'
      && chunkedBatchUploadInitSchema.safeParse({
        fileName: metadata.fileName,
        fileSize: metadata.fileSize,
        totalChunks: metadata.totalChunks,
      }).success
      && (metadata.purpose === undefined || metadata.purpose === 'batch' || metadata.purpose === 'problem-testcases')
      && (metadata.purpose !== 'problem-testcases' || (typeof metadata.problemId === 'string' && metadata.problemId.length > 0))
      && Number.isFinite(metadata.createdAt);
  }
}
