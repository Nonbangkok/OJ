import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export const TESTCASE_LIMITS = {
  MAX_CASES: 1000,
  MAX_FILE_BYTES: 64 * 1024 * 1024,
  MAX_TOTAL_BYTES: 512 * 1024 * 1024,
} as const;

export class TestcaseError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TestcaseError'; }
}

export function validateTestcaseFilename(name: string): string {
  if (name.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) {
    throw new TestcaseError('invalid_testcase_filename', `Unsafe testcase filename: ${name.slice(0, 255)}`);
  }
  return name;
}

/** Explicit locale and tie-break keep case numbers stable, including zero-padded ties. */
export function naturalFilenameCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}

export function decodeTestcaseText(buffer: Buffer, filename: string): string {
  if (buffer.length > TESTCASE_LIMITS.MAX_FILE_BYTES) {
    throw new TestcaseError('testcase_file_too_large', `Testcase exceeds 64 MiB: ${filename}`);
  }
  try {
    // ignoreBOM preserves a literal BOM instead of silently removing input bytes.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
    if (text.includes('\0')) throw new Error('NUL is not supported by PostgreSQL TEXT');
    return text;
  } catch { throw new TestcaseError('invalid_testcase_text', `Testcase must be UTF-8 text without NUL: ${filename}`); }
}

/** O_NONBLOCK avoids hanging on FIFOs before fstat can reject them. */
export async function readTestcaseFile(file: string): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new TestcaseError('invalid_testcase_file', 'Testcase must be an unlinked regular file');
    if (stat.size > TESTCASE_LIMITS.MAX_FILE_BYTES) throw new TestcaseError('testcase_file_too_large', 'Testcase exceeds 64 MiB');
    // Never allocate according to data a growing file supplies beyond its checked bound.
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== stat.size) throw new TestcaseError('invalid_testcase_file', 'Testcase changed during import');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
