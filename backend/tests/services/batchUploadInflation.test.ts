import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipArchive } from 'archiver';
import * as db from '../../db';
import { backendWorkRoot } from '../../utils/privateTemp';
import { countInflatedBytes, lyingZip } from '../fixtures/lyingZip';
import { withBackslashNames, withDeclaredSize } from '../fixtures/zipPatch';

// A9-08 (batch part): processBatchUpload validates the archive with
// assertSafeArchive, which sums the central directory's *declared*
// uncompressedSize. Extraction must count the bytes it actually inflates and
// stop as soon as an entry passes its declared size, so a lying archive can
// neither fill the disk nor sneak past the cap. The cap is lowered to 1 MiB
// here so the archives stay small: an entry that declares 100 bytes but
// inflates to 32 MiB used to be written out in full.

const MiB = 1024 * 1024;
const ARCHIVE_CAP = 1 * MiB;

jest.mock('../../constants', () => {
  const actual = jest.requireActual('../../constants');
  return {
    ...actual,
    ARCHIVE_LIMITS: { ...actual.ARCHIVE_LIMITS, MAX_UNCOMPRESSED_BYTES: 1 * 1024 * 1024 },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processBatchUpload } = require('../../services/batchUploadService') as typeof import('../../services/batchUploadService');

async function zipOf(entries: Array<[string, string | Buffer, { store?: boolean }?]>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve());
    archive.on('error', reject);
  });
  for (const [name, content, options] of entries) archive.append(content, { name, ...options });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

describe('processBatchUpload extraction is bounded by the real inflated size', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-inflation-'));
    (db.pool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 1 });
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const write = (name: string, content: Buffer): string => {
    const zipPath = path.join(workDir, name);
    fs.writeFileSync(zipPath, content);
    return zipPath;
  };

  it('rejects the archive without inflating far past the uncompressed cap', async () => {
    const zipPath = write('problems.zip', lyingZip('bomb.txt', 32 * MiB, 100));

    let results: Awaited<ReturnType<typeof processBatchUpload>> | undefined;
    const { bytes, error } = await countInflatedBytes(async () => {
      results = await processBatchUpload(zipPath);
    });

    expect(error).toBeNull();
    expect(bytes).toBeLessThan(ARCHIVE_CAP + 2 * MiB);
    expect(results?.errors).toEqual([
      { directory: 'Batch Process', message: expect.stringContaining('inflates past its declared size') },
    ]);
  });

  it('control: an archive that honestly declares more than the cap is rejected before extraction', async () => {
    const zipPath = write('honest.zip', lyingZip('big.txt', 2 * MiB, 2 * MiB));

    let results: Awaited<ReturnType<typeof processBatchUpload>> | undefined;
    const { bytes } = await countInflatedBytes(async () => {
      results = await processBatchUpload(zipPath);
    });

    expect(results?.errors.length).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(ARCHIVE_CAP + 2 * MiB);
  });

  it('bounds the nested input/output testcase ZIP the same way', async () => {
    const inner = withDeclaredSize(await zipOf([
      ['cases/input/1.in', Buffer.alloc(32 * MiB, 0x61)],
      ['cases/output/1.out', '1\n'],
    ]), 'cases/input/1.in', 100);
    const zipPath = write('nested.zip', await zipOf([
      ['p1/config.json', JSON.stringify({ id: 'p1', title: 'P1', author: 'A', time_limit_ms: 1000, memory_limit_mb: 256 })],
      ['p1/tests.zip', inner],
    ]));

    let results: Awaited<ReturnType<typeof processBatchUpload>> | undefined;
    const { bytes, error } = await countInflatedBytes(async () => {
      results = await processBatchUpload(zipPath);
    });

    expect(error).toBeNull();
    expect(bytes).toBeLessThan(ARCHIVE_CAP + 2 * MiB);
    // The problem itself imports; only its testcase ZIP is refused.
    expect(results).toMatchObject({ added: ['p1'], errors: [] });
    const sql = (db.pool.query as jest.Mock).mock.calls.map(([text]) => String(text));
    expect(sql.some((text) => text.includes('INSERT INTO testcases'))).toBe(false);
  });

  // The flat layout (1.in / 1.out at the inner ZIP root) is never extracted:
  // its paired entries are read straight into memory, so the bound has to
  // hold there too. A ZIP with an input\output layout written with backslash
  // separators is not detected as input/output and lands in this branch as
  // well; its names never pair (path.basename does not split on '\'), so
  // nothing is read today. That case passes on the old code too: it pins the
  // bound so a later change that pairs backslash names cannot reopen it.
  const problemConfig = JSON.stringify({ id: 'p1', title: 'P1', author: 'A', time_limit_ms: 1000, memory_limit_mb: 256 });
  const batchWithTestcaseZip = async (inner: Buffer): Promise<string> =>
    write('flat.zip', await zipOf([['p1/config.json', problemConfig], ['p1/tests.zip', inner]]));
  const testcaseInserts = (): unknown[][] => (db.pool.query as jest.Mock).mock.calls
    .filter(([text]) => String(text).includes('INSERT INTO testcases'))
    .map(([, values]) => values as unknown[]);

  it.each([
    ['flat', '1.in', '1.out'],
    ['backslash input\\output', 'cases/input/1.in', 'cases/output/1.out'],
  ])('bounds a %s-layout testcase ZIP the same way', async (layout, inName, outName) => {
    const lying = withDeclaredSize(await zipOf([
      [inName, Buffer.alloc(32 * MiB, 0x61)],
      [outName, '1\n'],
    ]), inName, 100);
    const inner = layout === 'flat' ? lying : withBackslashNames(lying);
    const zipPath = await batchWithTestcaseZip(inner);

    let results: Awaited<ReturnType<typeof processBatchUpload>> | undefined;
    const { bytes, error } = await countInflatedBytes(async () => {
      results = await processBatchUpload(zipPath);
    });

    expect(error).toBeNull();
    expect(bytes).toBeLessThan(ARCHIVE_CAP + 2 * MiB);
    expect(results).toMatchObject({ added: ['p1'], errors: [] });
    expect(testcaseInserts()).toEqual([]);
  });

  it('rejects a flat-layout testcase ZIP that honestly declares more than the cap before reading it', async () => {
    const zipPath = await batchWithTestcaseZip(await zipOf([
      ['1.in', Buffer.alloc(32 * MiB, 0x61)],
      ['1.out', '1\n'],
    ]));

    let results: Awaited<ReturnType<typeof processBatchUpload>> | undefined;
    const { bytes, error } = await countInflatedBytes(async () => {
      results = await processBatchUpload(zipPath);
    });

    expect(error).toBeNull();
    expect(bytes).toBeLessThan(ARCHIVE_CAP + 2 * MiB);
    expect(results).toMatchObject({ added: ['p1'], errors: [] });
    expect(testcaseInserts()).toEqual([]);
  });

  it('rejects a flat-layout entry that ends short of its declared size', async () => {
    const zipPath = await batchWithTestcaseZip(withDeclaredSize(await zipOf([
      ['1.in', '1 2\n'],
      ['1.out', '3\n'],
    ]), '1.in', 100));

    const results = await processBatchUpload(zipPath);

    expect(results).toMatchObject({ added: ['p1'], errors: [] });
    expect(testcaseInserts()).toEqual([]);
  });

  it('still imports an honest flat-layout testcase ZIP (stored and deflated entries) byte for byte', async () => {
    const zipPath = await batchWithTestcaseZip(await zipOf([
      ['1.in', '1 2\n', { store: true }],
      ['1.out', '3\n'],
      ['2.in', ''],
      ['2.out', 'x'.repeat(4096)],
    ]));

    const results = await processBatchUpload(zipPath);

    expect(results).toMatchObject({ added: ['p1'], errors: [] });
    expect(testcaseInserts()).toEqual([
      ['p1', 1, '1 2\n', '3\n'],
      ['p1', 2, '', 'x'.repeat(4096)],
    ]);
  });

  it('extracts an honest archive (directory, stored, empty and deflated entries) into 0700/0600 paths', async () => {
    const config = JSON.stringify({ id: 'p1', title: 'P1', author: 'A', time_limit_ms: 1000, memory_limit_mb: 256 });
    const zipPath = write('honest-tree.zip', await zipOf([
      ['p1/', ''],
      ['p1/config.json', config],
      ['p1/testcases/', ''],
      ['p1/testcases/1.in', '1 2\n', { store: true }],
      ['p1/testcases/1.out', '3\n'],
      ['p1/notes.txt', ''],
    ]));

    // Snapshot the extracted tree at the first statement of the problem's
    // transaction, while it is still on disk.
    let tree: Record<string, string> | null = null;
    (db.pool.query as jest.Mock).mockImplementation(async () => {
      if (!tree) {
        const root = backendWorkRoot();
        const [batchDir] = fs.readdirSync(root).filter((name) => name.startsWith('batch-'));
        const snapshot: Record<string, string> = {};
        const visit = (dir: string): void => {
          const stat = fs.lstatSync(dir);
          const relative = path.relative(path.join(root, batchDir), dir) || '.';
          snapshot[relative] = stat.isDirectory()
            ? `dir ${(stat.mode & 0o777).toString(8)}`
            : `file ${(stat.mode & 0o777).toString(8)} ${JSON.stringify(fs.readFileSync(dir, 'utf8'))}`;
          if (stat.isDirectory()) for (const name of fs.readdirSync(dir)) visit(path.join(dir, name));
        };
        visit(path.join(root, batchDir));
        tree = snapshot;
      }
      return { rows: [], rowCount: 1 };
    });

    const results = await processBatchUpload(zipPath);

    expect(results).toMatchObject({ added: ['p1'], errors: [] });
    expect(tree).toEqual({
      '.': 'dir 700',
      p1: 'dir 700',
      'p1/config.json': `file 600 ${JSON.stringify(config)}`,
      'p1/notes.txt': 'file 600 ""',
      'p1/testcases': 'dir 700',
      'p1/testcases/1.in': 'file 600 "1 2\\n"',
      'p1/testcases/1.out': 'file 600 "3\\n"',
    });
  });

  it('rejects an entry that inflates to fewer bytes than it declares', async () => {
    const zipPath = write('short.zip', lyingZip('short.txt', 50, 100));

    const results = await processBatchUpload(zipPath);

    expect(results.errors).toEqual([
      { directory: 'Batch Process', message: 'Archive rejected: entry "short.txt" holds 50 bytes but declares 100.' },
    ]);
  });

  it('rejects a backslash path that would escape the extraction directory', async () => {
    const escapee = `escape-${path.basename(workDir)}.txt`;
    const zipPath = write('slip.zip', lyingZip(`a\\..\\..\\${escapee}`, 10, 10));

    const results = await processBatchUpload(zipPath);

    expect(results.errors).toEqual([
      { directory: 'Batch Process', message: expect.stringContaining('path traversal') },
    ]);
    expect(fs.existsSync(path.join(os.tmpdir(), escapee))).toBe(false);
  });

  it('rejects duplicate entry names instead of letting the last copy win', async () => {
    const zipPath = write('dupe.zip', await zipOf([
      ['p1/config.json', '{}'],
      ['p1/config.json', JSON.stringify({ id: 'p1', title: 'P1', author: 'A', time_limit_ms: 1000, memory_limit_mb: 256 })],
    ]));

    const results = await processBatchUpload(zipPath);

    expect(results).toMatchObject({ added: [], errors: [{ directory: 'Batch Process', message: 'Archive rejected: duplicate entry "p1/config.json".' }] });
  });
});
