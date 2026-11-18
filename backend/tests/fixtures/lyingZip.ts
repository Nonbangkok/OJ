import zlib from 'zlib';

// G9 helper: build a ZIP whose single deflate entry declares a small
// uncompressedSize in both the local header and the central directory, while
// the compressed data actually inflates to `actualBytes`. compressedSize and
// CRC-32 are correct, so only the declared uncompressed size lies.

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function lyingZip(name: string, actualBytes: number, declaredBytes: number, fill = 0x61): Buffer {
  const data = Buffer.alloc(actualBytes, fill);
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(0x21, 12); // date (1980-01-01)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredBytes, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredBytes, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(0, 42); // local header offset

  const localPart = Buffer.concat([local, nameBuf, compressed]);
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localPart, centralPart, eocd]);
}

/**
 * Count every byte produced by zlib raw-inflate streams (what unzipper uses
 * for deflate entries) while `fn` runs.
 */
export async function countInflatedBytes(fn: () => Promise<unknown>): Promise<{ bytes: number; error: unknown }> {
  // zlib's factory exports are non-writable (but configurable), so
  // jest.spyOn cannot patch them; swap the property descriptor instead.
  const original = Object.getOwnPropertyDescriptor(zlib, 'createInflateRaw')!;
  const real = zlib.createInflateRaw;
  let bytes = 0;
  Object.defineProperty(zlib, 'createInflateRaw', {
    ...original,
    value: (options?: zlib.ZlibOptions) => {
      const stream = real.call(zlib, options);
      stream.on('data', (chunk: Buffer) => { bytes += chunk.length; });
      return stream;
    },
  });
  let error: unknown = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  } finally {
    Object.defineProperty(zlib, 'createInflateRaw', original);
  }
  return { bytes, error };
}
