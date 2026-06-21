import {
  assertSafeArchive,
  MAX_ARCHIVE_ENTRIES,
  type ArchiveEntryLike,
} from '../../services/batchUploadService';

/**
 * Unit tests for the archive safety guard (security item E): zip-slip and
 * zip-bomb protection applied to every uploaded archive before extraction.
 */
describe('assertSafeArchive', () => {
  const safeEntry = (path: string, uncompressedSize = 10): ArchiveEntryLike => ({
    path,
    type: 'File',
    uncompressedSize,
  });

  it('accepts a normal, well-formed archive', () => {
    const entries = [
      safeEntry('config.json'),
      safeEntry('problem/Problem.pdf'),
      safeEntry('problem/testcases/input/01.in'),
      safeEntry('problem/testcases/output/01.out'),
    ];
    expect(() => assertSafeArchive(entries)).not.toThrow();
  });

  it('rejects path traversal via ".." segments (zip-slip)', () => {
    expect(() => assertSafeArchive([safeEntry('../../etc/cron.d/evil')])).toThrow(/traversal/i);
    expect(() => assertSafeArchive([safeEntry('problem/../../escape.txt')])).toThrow(/traversal/i);
    expect(() => assertSafeArchive([safeEntry('..')])).toThrow(/traversal/i);
  });

  it('rejects absolute POSIX paths', () => {
    expect(() => assertSafeArchive([safeEntry('/etc/passwd')])).toThrow(/absolute/i);
  });

  it('rejects absolute Windows-style paths', () => {
    expect(() => assertSafeArchive([safeEntry('C:\\Windows\\System32\\evil.dll')])).toThrow(/absolute/i);
  });

  it('rejects archives with too many entries (zip-bomb by count)', () => {
    const tooMany = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_v, i) => safeEntry(`f${i}.txt`, 1));
    expect(() => assertSafeArchive(tooMany)).toThrow(/too many entries/i);
  });

  it('rejects archives whose uncompressed size exceeds the cap (decompression bomb)', () => {
    // Two entries that each claim ~400 MB → 800 MB total, over the 500 MB cap.
    const huge = [
      safeEntry('a.bin', 400 * 1024 * 1024),
      safeEntry('b.bin', 400 * 1024 * 1024),
    ];
    expect(() => assertSafeArchive(huge)).toThrow(/decompression bomb|uncompressed size/i);
  });

  it('does not throw on null/undefined/non-array input (defensive no-op)', () => {
    expect(() => assertSafeArchive(null)).not.toThrow();
    expect(() => assertSafeArchive(undefined)).not.toThrow();
    expect(() => assertSafeArchive([])).not.toThrow();
  });
});
