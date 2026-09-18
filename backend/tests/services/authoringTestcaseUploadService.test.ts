import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';

const servicePath = '../../services/authoringTestcaseUploadService';
it('reads the exact validated EOCD, including a long ZIP comment', async () => {
  const { prepareTestcaseArchive } = materializedService();
  const filename = await archive([['1.in', 'ok']]);
  const bytes = await readFile(filename);
  const comment = Buffer.alloc(1000, 65);
  bytes.writeUInt16LE(comment.length, bytes.length - 2);
  await writeFile(filename, Buffer.concat([bytes, comment]));
  expect(await prepareTestcaseArchive(filename)).toEqual([{ filename: '1.in', input: 'ok', output: null }]);
});

it('rejects an EOCD that claims a different central directory span', async () => {
  const { prepareTestcaseArchive } = materializedService();
  const filename = await archive([['1.in', 'ok']]);
  const bytes = await readFile(filename);
  bytes.writeUInt32LE(0, bytes.length - 22 + 12);
  await writeFile(filename, bytes);
  await expect(prepareTestcaseArchive(filename)).rejects.toMatchObject({ code: 'invalid_testcase_archive' });
});

it('provides lazy cases so a complete archive is never retained as decoded strings', async () => {
  const { prepareTestcaseArchive } = require(servicePath);
  const prepared = await prepareTestcaseArchive(await archive([['1.in', 'a'], ['2.in', Buffer.from([0xff])]]));
  const iterator = prepared[Symbol.asyncIterator]();
  expect(await iterator.next()).toEqual({ done: false, value: { filename: '1.in', input: 'a', output: null } });
  await expect(iterator.next()).rejects.toMatchObject({ code: 'invalid_testcase_text' });
});
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'oj-upload-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function archive(entries: [string, string | Buffer][], symlink = false): Promise<string> {
  const zip = archiver('zip');
  const chunks: Buffer[] = [];
  zip.on('data', chunk => chunks.push(chunk));
  for (const [name, data] of entries) zip.append(data, { name });
  if (symlink) zip.symlink('2.in', '/etc/passwd');
  await zip.finalize();
  const filename = path.join(root, 'cases.zip');
  await writeFile(filename, Buffer.concat(chunks));
  return filename;
}

it('pairs numbered flat files and preserves missing outputs and exact text', async () => {
  const { prepareTestcaseArchive } = materializedService();
  const result = await prepareTestcaseArchive(await archive([
    ['10.in', ' 10\r\n'], ['2.in', '2\n'], ['output2.txt', ' 4\n'],
  ]));
  expect(result).toEqual([
    { filename: '2.in', input: '2\n', output: ' 4\n' },
    { filename: '10.in', input: ' 10\r\n', output: null },
  ]);
});

it('pairs legacy input/output directories by independent natural order', async () => {
  const { prepareTestcaseArchive } = materializedService();
  expect(await prepareTestcaseArchive(await archive([
    ['task/input/10.txt', 'ten'], ['task/input/2.txt', 'two'],
    ['task/output/answer10.txt', 'TEN'], ['task/output/answer2.txt', 'TWO'],
  ]))).toEqual([
    { filename: '2.txt', input: 'two', output: 'TWO' },
    { filename: '10.txt', input: 'ten', output: 'TEN' },
  ]);
});

it.each([
  [['1.out', 'orphan']],
  [['1.in', 'a'], ['input1.txt', 'duplicate']],
  [['input/1.txt', 'a'], ['input/2.txt', 'b'], ['output/answer.txt', 'ambiguous']],
  [['1.in', 'a'], ['1.in', 'duplicate']],
  [['1.in', Buffer.from([0xc3, 0x28])]],
  [['1.in', 'a\0b']],
] as [string, string | Buffer][][])('rejects unsafe or ambiguous archive %# before importing it', async (...entries) => {
  const { prepareTestcaseArchive } = materializedService();
  await expect(prepareTestcaseArchive(await archive(entries))).rejects.toMatchObject({ code: expect.any(String) });
});

it('rejects symlinks even though no files are extracted', async () => {
  const { prepareTestcaseArchive } = materializedService();
  await expect(prepareTestcaseArchive(await archive([['1.in', 'ok']], true))).rejects.toMatchObject({ code: expect.any(String) });
});

it('rejects traversal paths before opening entry streams', async () => {
  const { prepareTestcaseArchive } = materializedService();
  const filename = await archive([['xxx/1.in', 'ok']]);
  const bytes = await readFile(filename);
  // Equal-length replacement leaves the ZIP structure intact.
  await writeFile(filename, Buffer.from(bytes.toString('latin1').replaceAll('xxx/1.in', '../1x.in'), 'latin1'));
  await expect(prepareTestcaseArchive(filename)).rejects.toMatchObject({ code: expect.any(String) });
});

it('rejects too many cases and a compressed oversized input', async () => {
  const { prepareTestcaseArchive } = materializedService();
  await expect(prepareTestcaseArchive(await archive(Array.from({ length: 1001 }, (_, i) => [`${i}.in`, 'x']))))
    .rejects.toMatchObject({ code: expect.any(String) });
  await expect(prepareTestcaseArchive(await archive([['1.in', Buffer.alloc(64 * 1024 * 1024 + 1, 65)]])))
    .rejects.toMatchObject({ code: expect.any(String) });
});

it('ignores legacy macOS ZIP metadata while retaining real cases', async () => {
  const { prepareTestcaseArchive } = materializedService();
  expect(await prepareTestcaseArchive(await archive([
    ['1.in', 'ok'], ['__MACOSX/._1.in', 'metadata'], ['.DS_Store', 'metadata'],
  ]))).toEqual([{ filename: '1.in', input: 'ok', output: null }]);
});

it('rejects decompression beyond the declared size even if central metadata lies', async () => {
  const { prepareTestcaseArchive } = materializedService();
  const filename = await archive([['1.in', '0123456789']]);
  const bytes = await readFile(filename);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(1, central + 24);
  await writeFile(filename, bytes);
  await expect(prepareTestcaseArchive(filename)).rejects.toMatchObject({ code: 'invalid_testcase_archive' });
});

// Small fixture helper only; production consumes the async iterator inside its DB transaction.
function materializedService() {
  return { prepareTestcaseArchive: async (filename: string) => {
    const result = [];
    for await (const testcase of await require(servicePath).prepareTestcaseArchive(filename)) result.push(testcase);
    return result;
  } };
}
