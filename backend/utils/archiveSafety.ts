import path from 'path';
import { ARCHIVE_LIMITS } from '../constants';

const MAX_ARCHIVE_UNCOMPRESSED_BYTES = ARCHIVE_LIMITS.MAX_UNCOMPRESSED_BYTES;
export const MAX_ARCHIVE_ENTRIES = ARCHIVE_LIMITS.MAX_ENTRIES;

/**
 * The shape of an opened archive entry this guard needs — `unzipper`'s
 * directory entries structurally satisfy it, and so do test fixtures.
 */
export interface ArchiveEntryLike {
  path: string;
  type?: string;
  uncompressedSize?: number;
}

/**
 * Validate every entry of an opened archive *before* extraction.
 *
 * - Zip-slip: reject absolute paths and any path that escapes the target
 *   directory via `..` segments (normalised, cross-platform).
 * - Zip-bomb: reject archives with too many entries or whose total
 *   uncompressed size exceeds the cap.
 *
 * Throws an Error (which callers surface as a per-archive failure) if unsafe.
 *
 * Lives in `utils/` on purpose: both `services/batchUploadService` and
 * `utils/headerProblemFiles` need it, and a util must never import a service
 * (that inverted the layering and made the import graph circular).
 */
export function assertSafeArchive(entries: ArchiveEntryLike[] | undefined | null): void {
  if (!Array.isArray(entries)) {
    return;
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Archive rejected: too many entries (${entries.length} > ${MAX_ARCHIVE_ENTRIES}).`);
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    const entryPath = entry.path ?? '';

    // Reject absolute paths (POSIX or Windows-style).
    if (path.isAbsolute(entryPath) || /^[a-zA-Z]:[\\/]/.test(entryPath)) {
      throw new Error(`Archive rejected: absolute entry path "${entryPath}".`);
    }

    // Normalise and ensure the entry stays within the extraction root.
    const normalized = path.normalize(entryPath);
    if (normalized.startsWith('..' + path.sep) || normalized === '..' || normalized.includes('..' + path.sep)) {
      throw new Error(`Archive rejected: path traversal in entry "${entryPath}".`);
    }

    totalUncompressed += entry.uncompressedSize ?? 0;
    if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error(`Archive rejected: uncompressed size exceeds ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} bytes (decompression bomb).`);
    }
  }
}
