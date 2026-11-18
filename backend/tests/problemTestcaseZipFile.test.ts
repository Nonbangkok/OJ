import { Readable } from 'stream';
import { setFlagsFromString } from 'v8';
import { runInNewContext } from 'vm';
import * as db from '../db';
import * as zipEntryReader from '../utils/zipEntryReader';
import unzipper from 'unzipper';
import { ARCHIVE_LIMITS } from '../constants';
import { AppError } from '../middleware/errorHandler';
import { replaceProblemTestcasesFromZip, replaceProblemTestcasesFromZipFile } from '../services/problemQueryService';

jest.mock('../db');
jest.mock('unzipper');

const MiB = 1024 * 1024;

/** A mocked unzipper entry: `stream()` yields `content`, `buffer()` (the old read path) returns it whole. */
const entry = (path: string, content: Buffer, declared = content.length) => ({
  path,
  type: 'File',
  uncompressedSize: declared,
  stream: () => Readable.from([content]),
  buffer: async () => content,
});

/**
 * An entry declaring `declared` bytes whose data inflates to `actual` bytes,
 * delivered in 64 KiB chunks; `produced()` reports how many bytes were
 * inflated through either read path.
 */
const lyingEntry = (path: string, declared: number, actual: number) => {
  let produced = 0;
  const chunk = 64 * 1024;
  return {
    produced: () => produced,
    file: {
      path,
      type: 'File',
      uncompressedSize: declared,
      stream: () => new Readable({
        read() {
          if (produced >= actual) { this.push(null); return; }
          produced += chunk;
          this.push(Buffer.alloc(chunk, 0x31));
        },
      }),
      buffer: async () => { produced += actual; return Buffer.alloc(actual, 0x31); },
    },
  };
};

describe('replaceProblemTestcasesFromZipFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('opens the assembled ZIP by path and replaces testcases transactionally', async () => {
    const files = [entry('input1.in', Buffer.from('1 2\n')), entry('output1.out', Buffer.from('3\n'))];
    (unzipper.Open.custom as jest.Mock).mockResolvedValueOnce({ files });
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'P1' }] });
    const clientQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const release = jest.fn();
    (db.pool.connect as jest.Mock).mockResolvedValueOnce({ query: clientQuery, release });

    await expect(replaceProblemTestcasesFromZipFile('P1', '/tmp/assembled-testcases.zip'))
      .resolves.toEqual({ kind: 'ok', insertedCount: 1 });

    // Opened from disk through a file source that closes its streams afterwards.
    expect(unzipper.Open.custom).toHaveBeenCalledTimes(1);
    expect(unzipper.Open.buffer).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQuery).toHaveBeenNthCalledWith(2, 'DELETE FROM testcases WHERE problem_id = $1', ['P1']);
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
      ['P1', 1, '1 2\n', '3\n'],
    );
    expect(clientQuery).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  // pg copies a pair's text two to three more times while serialising its
  // INSERT, so a pair's buffers must not stay reachable through the rest of
  // the transaction: in a 1 GiB container that lowers the worst-case peak
  // (two 64 + 64 MiB pairs) from about 810 to about 610 MiB.
  it('lets each pair\'s buffers be collected once its INSERT text is made', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const original = zipEntryReader.readZipEntryBounded;
    const read: Array<WeakRef<Buffer>> = [];
    // A plain wrapper, not jest.spyOn: a spy's mock.results would keep every buffer alive.
    (zipEntryReader as { readZipEntryBounded: typeof original }).readZipEntryBounded = async (...args) => {
      const content = await original(...args);
      read.push(new WeakRef(content));
      return content;
    };
    try {
      const files = [1, 2, 3].flatMap((i) => [
        entry(`input${i}.in`, Buffer.alloc(256 * 1024, 0x30 + i)),
        entry(`output${i}.out`, Buffer.alloc(256 * 1024, 0x40 + i)),
      ]);
      (unzipper.Open.custom as jest.Mock).mockResolvedValueOnce({ files });
      (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'P1' }] });
      const reachableAtInsert: boolean[][] = [];
      const clientQuery = jest.fn(async (sql: string) => {
        if (sql.startsWith('INSERT')) {
          // deref() keeps a live target until the current job ends, so let
          // the previous check's job end before collecting.
          await new Promise((resolve) => { setImmediate(resolve); });
          gc();
          reachableAtInsert.push(read.map((ref) => ref.deref() !== undefined));
        }
        return { rows: [], rowCount: 1 };
      });
      (db.pool.connect as jest.Mock).mockResolvedValueOnce({ query: clientQuery, release: jest.fn() });

      await expect(replaceProblemTestcasesFromZipFile('P1', '/tmp/assembled-testcases.zip'))
        .resolves.toEqual({ kind: 'ok', insertedCount: 3 });

      // [in1, out1, in2, out2, in3, out3]: the pair being inserted, and every
      // pair before it, is already gone; later pairs wait their turn.
      expect(reachableAtInsert).toEqual([
        [false, false, true, true, true, true],
        [false, false, false, false, true, true],
        [false, false, false, false, false, false],
      ]);
    } finally {
      (zipEntryReader as { readZipEntryBounded: typeof original }).readZipEntryBounded = original;
    }
  });
});

describe('testcase ZIP size limits', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('stops inflating an entry that lies about its size and rejects the ZIP with a 400', async () => {
    const lying = lyingEntry('input1.in', 100, 8 * MiB);
    const files = [lying.file, entry('output1.out', Buffer.from('3\n'))];
    (unzipper.Open.buffer as jest.Mock).mockResolvedValueOnce({ files });

    const result = replaceProblemTestcasesFromZip('P1', Buffer.from('zip'));

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({
      statusCode: 400,
      message: 'ZIP entry "input1.in" does not match its declared size.',
    });
    expect(lying.produced()).toBeLessThan(MiB);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  // Every paired entry is held in RAM, and pg copies each pair again while
  // serialising its INSERT, so these caps sit far below both the 1 GiB
  // backend container and the 500 MB ARCHIVE_LIMITS cap disk extraction uses.
  const tooLargeInAll = 'Testcase ZIP rejected: its testcase files total more than 256 MiB uncompressed.';

  /** `count` pairs whose files each declare `declaredEach` bytes but hold 16. */
  const declaredPairs = (count: number, declaredEach: number) => {
    const entries: Array<ReturnType<typeof lyingEntry>> = [];
    for (let i = 1; i <= count; i += 1) {
      entries.push(lyingEntry(`input${i}.in`, declaredEach, 16), lyingEntry(`output${i}.out`, declaredEach, 16));
    }
    return { files: entries.map((e) => e.file), produced: () => entries.reduce((n, e) => n + e.produced(), 0) };
  };

  it('rejects testcase files declaring more than 256 MiB in all before inflating anything', async () => {
    const pairs = declaredPairs(3, 43 * MiB); // 258 MiB: under ARCHIVE_LIMITS and the per-file cap
    expect(6 * 43 * MiB).toBeLessThan(ARCHIVE_LIMITS.MAX_UNCOMPRESSED_BYTES);
    (unzipper.Open.buffer as jest.Mock).mockResolvedValueOnce({ files: pairs.files });

    const result = replaceProblemTestcasesFromZip('P1', Buffer.from('zip'));

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ statusCode: 400, message: tooLargeInAll });
    expect(pairs.produced()).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('applies the same cap to the chunked, disk-backed upload', async () => {
    const pairs = declaredPairs(3, 43 * MiB);
    (unzipper.Open.custom as jest.Mock).mockResolvedValueOnce({ files: pairs.files });

    const result = replaceProblemTestcasesFromZipFile('P1', '/tmp/assembled-testcases.zip');

    await expect(result).rejects.toMatchObject({ statusCode: 400, message: tooLargeInAll });
    expect(pairs.produced()).toBe(0);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  // One pair is serialised whole into its INSERT, so a single file may not
  // take the whole in-memory budget.
  it('rejects a testcase file declaring more than 64 MiB before inflating anything', async () => {
    const input = lyingEntry('input1.in', 64 * MiB + 1, 16);
    const output = lyingEntry('output1.out', 16, 16);
    (unzipper.Open.custom as jest.Mock).mockResolvedValueOnce({ files: [input.file, output.file] });

    const result = replaceProblemTestcasesFromZipFile('P1', '/tmp/assembled-testcases.zip');

    await expect(result).rejects.toMatchObject({
      statusCode: 400,
      message: 'Testcase ZIP rejected: "input1.in" is larger than 64 MiB uncompressed.',
    });
    expect(input.produced() + output.produced()).toBe(0);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('lets a corrupt-entry error through unchanged', async () => {
    const broken = {
      path: 'input1.in',
      type: 'File',
      uncompressedSize: 10,
      stream: () => new Readable({ read() { this.destroy(new Error('invalid distance too far back')); } }),
      buffer: async () => { throw new Error('invalid distance too far back'); },
    };
    (unzipper.Open.buffer as jest.Mock).mockResolvedValueOnce({ files: [broken, entry('output1.out', Buffer.from('3\n'))] });

    const result = replaceProblemTestcasesFromZip('P1', Buffer.from('zip'));
    await expect(result).rejects.toThrow('invalid distance too far back');
    await expect(result).rejects.not.toBeInstanceOf(AppError);
  });
});
