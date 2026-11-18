// Byte-level edits of a finished ZIP (central directory and local headers),
// for archives no well-behaved writer produces: a lying declared size, or
// entry names with backslash separators.

/** Rewrite the central-directory uncompressedSize of `name` (what unzipper's Open trusts). */
export function withDeclaredSize(zip: Buffer, name: string, declared: number): Buffer {
  const patched = Buffer.from(zip);
  for (let offset = patched.length - 46; offset >= 0; offset--) {
    if (patched.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = patched.readUInt16LE(offset + 28);
    if (patched.subarray(offset + 46, offset + 46 + nameLength).toString('utf8') === name) {
      patched.writeUInt32LE(declared, offset + 24);
      return patched;
    }
  }
  throw new Error(`entry ${name} not found`);
}

/**
 * Write every entry name with backslash separators, in the central directory
 * and the local headers (archiver normalises them to '/', some Windows tools
 * do not).
 */
export function withBackslashNames(zip: Buffer): Buffer {
  const patched = Buffer.from(zip);
  for (let offset = patched.length - 46; offset >= 0; offset--) {
    if (patched.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = patched.readUInt16LE(offset + 28);
    const name = Buffer.from(patched.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\//g, '\\'), 'utf8');
    name.copy(patched, offset + 46);
    name.copy(patched, patched.readUInt32LE(offset + 42) + 30);
  }
  return patched;
}
