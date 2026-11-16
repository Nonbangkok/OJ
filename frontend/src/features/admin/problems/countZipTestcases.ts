/**
 * Counts the testcases a ZIP will produce, before uploading it, so the
 * replace confirm can say "Replace 10 testcases with 12?". Reads only the
 * end-of-central-directory record and the central directory (file names),
 * never the file data. Pairing mirrors backend/services/testcaseZipPairing.ts.
 * Returns null when the file isn't a readable ZIP (ZIP64 included) — the
 * server stays the judge; the count is only for the confirm text.
 */
const TESTCASE_FILE_REGEX = /^(?:input|output)?(\d+)\.(?:in|out|txt|sol)$/i;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

const readBytes = (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
};

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const ascii = (b: Uint8Array, from: number, length: number) => String.fromCharCode(...b.subarray(from, from + length));

export async function countZipTestcases(file: Blob): Promise<number | null> {
  try {
    if (file.size < EOCD_MIN) return null;
    const tailStart = Math.max(0, file.size - (EOCD_MIN + MAX_COMMENT));
    const tail = await readBytes(file.slice(tailStart));
    let eocd = -1;
    for (let i = tail.length - EOCD_MIN; i >= 0; i -= 1) {
      if (u32(tail, i) === EOCD_SIGNATURE) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const entries = u16(tail, eocd + 10);
    const size = u32(tail, eocd + 12);
    const offset = u32(tail, eocd + 16);
    if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null; // ZIP64
    if (size > MAX_DIRECTORY_BYTES || offset + size > file.size) return null;

    const dir = await readBytes(file.slice(offset, offset + size));
    const pairs = new Map<number, { in?: true; out?: true }>();
    let at = 0;
    for (let n = 0; n < entries; n += 1) {
      if (at + 46 > dir.length || u32(dir, at) !== CENTRAL_SIGNATURE) return null;
      const nameLength = u16(dir, at + 28);
      const extraLength = u16(dir, at + 30);
      const commentLength = u16(dir, at + 32);
      const path = ascii(dir, at + 46, nameLength);
      at += 46 + nameLength + extraLength + commentLength;

      const fileName = path.split('/').pop() ?? '';
      if (path.endsWith('/') || path.startsWith('__MACOSX/') || fileName.startsWith('._')) continue;
      const match = fileName.match(TESTCASE_FILE_REGEX);
      if (!match) continue;
      const number = Number.parseInt(match[1], 10);
      const pair = pairs.get(number) ?? {};
      const lower = fileName.toLowerCase();
      if (lower.endsWith('.in') || lower.includes('input')) pair.in = true;
      else if (lower.endsWith('.out') || lower.endsWith('.sol') || lower.includes('output')) pair.out = true;
      pairs.set(number, pair);
    }
    return [...pairs.values()].filter((p) => p.in && p.out).length;
  } catch {
    return null;
  }
}
