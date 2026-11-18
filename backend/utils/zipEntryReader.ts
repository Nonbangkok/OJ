import fs from 'fs';
import * as unzipper from 'unzipper';

/**
 * The part of an opened `unzipper` entry this reader needs; `unzipper.File`
 * satisfies it structurally, and so do test fixtures.
 */
export interface ReadableZipEntry {
  path: string;
  /** Declared by the archive (central directory), so attacker-controlled. */
  uncompressedSize: number;
  stream: () => NodeJS.ReadableStream & { destroy: (error?: Error) => unknown };
}

/**
 * Uncompressed bytes shared by every entry read from one archive. Each read
 * charges its entry's declared size (which must equal its real size) before
 * inflating anything.
 */
export interface ArchiveInflateBudget {
  readonly maxBytes: number;
  usedBytes: number;
}

export const createInflateBudget = (maxBytes: number): ArchiveInflateBudget => ({ maxBytes, usedBytes: 0 });

const ignoreLateError = (): void => {};

/** An entry, or the archive as a whole, inflates past its cap or lies about its size. */
export class ZipEntryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipEntryLimitError';
  }
}

/**
 * Inflate one ZIP entry into memory, counting the bytes that actually leave
 * the decompressor instead of trusting the sizes the archive declares: a
 * central directory can declare 100 bytes for a deflate stream that expands to
 * gigabytes, and `entry.buffer()` would inflate all of it before any length
 * check.
 *
 * Real bytes must equal the declared uncompressedSize, so an entry declaring
 * more than `maxEntryBytes` or than the shared archive `budget` has left can
 * never be read successfully: it is refused before its stream is opened, and
 * its declared size is charged to the budget up front. That bounds the
 * declared size, so the reader allocates it once and copies each chunk in
 * (one copy of the entry at the peak, not a chunk list plus its
 * concatenation). Reading stops on the first chunk past the declared size,
 * and an entry that ends short of it is rejected too.
 */
export async function readZipEntryBounded(
  entry: ReadableZipEntry,
  maxEntryBytes: number,
  budget?: ArchiveInflateBudget,
): Promise<Buffer> {
  const declared = entry.uncompressedSize;
  if (!Number.isSafeInteger(declared) || declared < 0) {
    throw new ZipEntryLimitError(`ZIP entry "${entry.path}" does not match its declared size.`);
  }
  if (declared > maxEntryBytes) {
    throw new ZipEntryLimitError(`ZIP entry "${entry.path}" exceeds ${maxEntryBytes} bytes.`);
  }
  if (budget) {
    if (declared > budget.maxBytes - budget.usedBytes) {
      throw new ZipEntryLimitError(
        `Archive rejected: uncompressed size exceeds ${budget.maxBytes} bytes (decompression bomb).`,
      );
    }
    budget.usedBytes += declared;
  }

  const content = Buffer.allocUnsafe(declared);
  const stream = entry.stream();
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size + buffer.length > declared) {
        throw new ZipEntryLimitError(`ZIP entry "${entry.path}" does not match its declared size.`);
      }
      buffer.copy(content, size);
      size += buffer.length;
    }
  } finally {
    // unzipper forwards decompressor errors to the entry stream, and the
    // decompressor can still be working through buffered input after an
    // early stop. The outcome is already decided here, so such a late error
    // is dropped instead of surfacing as an unhandled 'error' event.
    stream.on('error', ignoreLateError);
    stream.destroy();
  }
  if (size !== declared) {
    throw new ZipEntryLimitError(`ZIP entry "${entry.path}" does not match its declared size.`);
  }
  return content;
}

/**
 * `unzipper.Open.file`, except that every read stream it opens on the archive
 * is closed before this settles. A read that stops early (readZipEntryBounded
 * hitting a limit) otherwise leaves the entry's file stream paused with its
 * descriptor open, which keeps an already-deleted upload's disk space
 * allocated until the process restarts.
 */
export async function withZipFile<T>(
  zipPath: string,
  use: (directory: unzipper.CentralDirectory) => Promise<T>,
): Promise<T> {
  const streams = new Set<fs.ReadStream>();
  try {
    const directory = await unzipper.Open.custom({
      size: async () => (await fs.promises.stat(zipPath)).size,
      stream: (offset: number, length?: number) => {
        // The same byte range unzipper's own file source reads.
        const stream = fs.createReadStream(zipPath, { start: offset, end: length ? offset + length : undefined });
        streams.add(stream);
        stream.once('close', () => streams.delete(stream));
        return stream;
      },
    });
    return await use(directory);
  } finally {
    // Wait for the descriptors to be released, so the caller can delete the
    // file as soon as this settles.
    await Promise.all([...streams].map((stream) => new Promise<void>((resolve) => {
      stream.once('close', () => resolve());
      stream.destroy();
    })));
  }
}
