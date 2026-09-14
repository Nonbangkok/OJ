import { open, readFile, stat } from 'node:fs/promises';
import * as unzipper from 'unzipper';
import { TESTCASE_LIMITS, TestcaseError, decodeTestcaseText, naturalFilenameCompare, validateTestcaseFilename } from '../authoring/testcases';

export type PreparedTestcase = { filename: string; input: string; output: string | null };
export type PreparedTestcasePatch = { filename?: string; input?: string; output?: string };
const fail = (code: string, message: string): never => { throw new TestcaseError(code, message); };
const MAX_ENTRIES = TESTCASE_LIMITS.MAX_CASES * 2 + 64;

/** Read bounded disk-backed uploads without normalizing testcase whitespace. */
export async function prepareTestcaseFile(file: Pick<Express.Multer.File, 'path' | 'originalname'>): Promise<{ filename: string; content: string }> {
  const filename = validateTestcaseFilename(file.originalname);
  if ((await stat(file.path)).size > TESTCASE_LIMITS.MAX_FILE_BYTES) fail('testcase_file_too_large', `${filename} exceeds the testcase file size limit`);
  return { filename, content: decodeTestcaseText(await readFile(file.path), filename) };
}

/** Reject huge/ZIP64 central directories before unzipper allocates their entries. */
async function preflightZip(filename: string): Promise<number> {
  const handle = await open(filename, 'r');
  try {
    const size = (await handle.stat()).size;
    if (size > TESTCASE_LIMITS.MAX_TOTAL_BYTES) fail('testcase_archive_too_large', 'Testcase ZIP exceeds the upload size limit');
    const tail = Buffer.alloc(Math.min(size, 65_557));
    await handle.read(tail, 0, tail.length, size - tail.length);
    let offset = tail.length - 22;
    while (offset >= 0 && !(tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length)) offset--;
    if (offset < 0) fail('invalid_testcase_archive', 'Testcase ZIP has no valid central directory');
    const count = tail.readUInt16LE(offset + 10);
    if (count > MAX_ENTRIES) fail('testcase_count_exceeded', 'Testcase ZIP contains too many entries');
    if (tail.readUInt16LE(offset + 4) || tail.readUInt16LE(offset + 6) || tail.readUInt16LE(offset + 8) !== count
      || tail.readUInt32LE(offset + 12) > MAX_ENTRIES * 1024 || tail.readUInt32LE(offset + 16) === 0xffffffff) {
      fail('invalid_testcase_archive', 'Split, ZIP64, or oversized ZIP directories are not supported');
    }
    const directoryOffset = tail.readUInt32LE(offset + 16);
    const directorySize = tail.readUInt32LE(offset + 12);
    const eocdOffset = size - tail.length + offset;
    if (directoryOffset + directorySize !== eocdOffset) fail('invalid_testcase_archive', 'Invalid central directory bounds');
    const directory = Buffer.alloc(directorySize);
    if ((await handle.read(directory, 0, directory.length, directoryOffset)).bytesRead !== directorySize) fail('invalid_testcase_archive', 'Truncated central directory');
    let cursor = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) fail('invalid_testcase_archive', 'Invalid central directory record');
      if (directory.readUInt16LE(cursor + 34) !== 0 || directory.readUInt32LE(cursor + 20) === 0xffffffff
        || directory.readUInt32LE(cursor + 24) === 0xffffffff || directory.readUInt32LE(cursor + 42) >= directoryOffset) fail('invalid_testcase_archive', 'Unsupported ZIP entry offset or size');
      cursor += 46 + directory.readUInt16LE(cursor + 28) + directory.readUInt16LE(cursor + 30) + directory.readUInt16LE(cursor + 32);
      if (cursor > directory.length) fail('invalid_testcase_archive', 'Truncated central directory record');
    }
    if (cursor !== directory.length) fail('invalid_testcase_archive', 'Unexpected central directory records');
    return size - eocdOffset;
  } finally { await handle.close(); }
}

/** Pair legacy archive layouts without extracting any paths to the filesystem. */
export async function prepareTestcaseArchive(filename: string): Promise<AsyncIterable<PreparedTestcase>> {
  try {
    const tailSize = await preflightZip(filename);
    // Installed unzipper supports options, but its DefinitelyTyped declaration omits them.
    const openZip = unzipper.Open.file as (file: string, options: { tailSize: number }) => Promise<unzipper.CentralDirectory>;
    const archive = await openZip(filename, { tailSize });
    if (archive.files.length > MAX_ENTRIES) fail('testcase_count_exceeded', 'Testcase ZIP contains too many entries');
    const names = new Set<string>();
    let declaredTotal = 0;
    const files: unzipper.File[] = [];
    for (const file of archive.files) {
      const name = file.path;
      const parts = name.replace(/\/$/, '').split('/');
      if (!name || name.startsWith('/') || name.includes('\\') || name.length > 1024 || parts.some(p => !p || p === '.' || p === '..')) {
        fail('unsafe_testcase_archive', `Unsafe ZIP entry: ${name}`);
      }
      for (const part of parts) {
        // Finder metadata is ignored by the existing grader pairing convention.
        if (part === '__MACOSX' || part === '.DS_Store' || (part.startsWith('._') && /^[A-Za-z0-9._-]{1,255}$/.test(part) && !part.includes('..'))) continue;
        validateTestcaseFilename(part);
      }
      if (names.has(name)) fail('duplicate_testcase_filename', `Duplicate ZIP entry: ${name}`);
      names.add(name);
      const mode = (file.externalFileAttributes >>> 16) & 0xf000;
      if ((mode !== 0 && mode !== 0x8000 && mode !== 0x4000) || (file.flags & 1)
        || (file.type !== 'File' && file.type !== 'Directory') || (mode === 0x4000 && file.type !== 'Directory')) {
        fail('unsafe_testcase_archive', `ZIP entry must be an unencrypted regular file or directory: ${name}`);
      }
      if (file.uncompressedSize > TESTCASE_LIMITS.MAX_FILE_BYTES) fail('testcase_file_too_large', `${name} exceeds the testcase file size limit`);
      declaredTotal += file.uncompressedSize;
      if (declaredTotal > TESTCASE_LIMITS.MAX_TOTAL_BYTES) fail('testcase_total_size_exceeded', 'Testcase ZIP exceeds the total uncompressed size limit');
      if (file.type === 'File') files.push(file);
    }
    const pairs = pairFiles(files);
    if (!pairs.length) fail('testcase_input_required', 'Testcase ZIP must contain at least one input');
    if (pairs.length > TESTCASE_LIMITS.MAX_CASES) fail('testcase_count_exceeded', 'Testcase ZIP contains too many cases');
    let total = 0;
    async function read(file: unzipper.File): Promise<string> {
      const chunks: Buffer[] = []; let size = 0;
      const stream = file.stream();
      try {
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length; total += buffer.length;
          if (size > TESTCASE_LIMITS.MAX_FILE_BYTES) fail('testcase_file_too_large', `${file.path} exceeds the testcase file size limit`);
          if (total > TESTCASE_LIMITS.MAX_TOTAL_BYTES) fail('testcase_total_size_exceeded', 'Testcase ZIP exceeds the total uncompressed size limit');
          chunks.push(buffer);
        }
      } finally { stream.destroy(); }
      if (size !== file.uncompressedSize) fail('invalid_testcase_archive', `Invalid decompressed size for ${file.path}`);
      return decodeTestcaseText(Buffer.concat(chunks), file.path);
    }
    return (async function* () {
      try {
        for (const pair of pairs) yield { filename: pair.input.path.split('/').pop()!, input: await read(pair.input), output: pair.output ? await read(pair.output) : null };
      } catch (error) {
        if (error instanceof TestcaseError) throw error;
        throw new TestcaseError('invalid_testcase_archive', 'Cannot read testcase ZIP entry');
      }
    })();
  } catch (error) {
    if (error instanceof TestcaseError) throw error;
    throw new TestcaseError('invalid_testcase_archive', 'Cannot read testcase ZIP');
  }
}

type Pair = { input: unzipper.File; output?: unzipper.File };
function pairFiles(files: unzipper.File[]): Pair[] {
  const basename = (file: unzipper.File) => file.path.split('/').pop()!;
  const sorted = (items: unzipper.File[]) => items.sort((a, b) => naturalFilenameCompare(basename(a), basename(b)));
  const useful = files.filter(f => !f.path.split('/').some(p => p === '__MACOSX' || p === '.DS_Store' || p.startsWith('._')));
  const directoryFiles = useful.filter(f => /(?:^|\/)(input|output)\//i.test(f.path));
  if (directoryFiles.length) {
    if (directoryFiles.length !== useful.length) fail('ambiguous_testcase_archive', 'Cannot mix flat cases with input/output directories');
    const inputs: unzipper.File[] = []; const outputs: unzipper.File[] = []; const roots = new Set<string>();
    for (const file of useful) {
      const match = file.path.match(/^(?:(.*)\/)?(input|output)\/([^/]+)$/i);
      if (!match) fail('ambiguous_testcase_archive', `Nested testcase directory is ambiguous: ${file.path}`);
      roots.add(match![1] ?? '');
      (match![2].toLowerCase() === 'input' ? inputs : outputs).push(file);
    }
    if (roots.size !== 1 || !inputs.length || outputs.length > inputs.length) fail('ambiguous_testcase_archive', 'ZIP must contain one input/output directory pair with an input for every output');
    sorted(inputs); sorted(outputs);
    if (inputs.length === outputs.length) return inputs.map((input, i) => ({ input, output: outputs[i] }));
    const byName = new Map(outputs.map(f => [basename(f), f]));
    if (outputs.some(o => !inputs.some(i => basename(i) === basename(o)))) fail('ambiguous_testcase_archive', 'Partial output directories require matching input filenames');
    return inputs.map(input => ({ input, output: byName.get(basename(input)) }));
  }
  const numbered = new Map<string, Partial<Pair>>(); const roots = new Set<string>();
  for (const file of useful) {
    const name = basename(file); const match = name.match(/^(input|output)?(\d+)\.(in|out|txt|sol)$/i);
    if (!match) fail('ambiguous_testcase_archive', `Unrecognized testcase filename: ${name}`);
    const prefix = match![1]?.toLowerCase(); const ext = match![3].toLowerCase();
    const input = ext === 'in' || prefix === 'input';
    const output = ext === 'out' || ext === 'sol' || prefix === 'output';
    if (input === output) fail('ambiguous_testcase_archive', `Ambiguous testcase filename: ${name}`);
    roots.add(file.path.slice(0, -name.length));
    const key = BigInt(match![2]).toString(); const pair = numbered.get(key) ?? {};
    const side = input ? 'input' : 'output';
    if (pair[side]) fail('ambiguous_testcase_archive', `Duplicate testcase ${side}: ${name}`);
    pair[side] = file; numbered.set(key, pair);
  }
  if (roots.size > 1) fail('ambiguous_testcase_archive', 'Flat testcase files must share one directory');
  const pairs = [...numbered.values()];
  if (pairs.some(p => !p.input)) fail('testcase_input_required', 'Every output requires a matching input');
  return (pairs as Pair[]).sort((a, b) => naturalFilenameCompare(basename(a.input), basename(b.input)));
}
