import { Readable } from 'stream';
import * as db from '../db';
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

  it('rejects a ZIP whose declared testcase sizes exceed the archive cap before inflating anything', async () => {
    const half = Math.floor(ARCHIVE_LIMITS.MAX_UNCOMPRESSED_BYTES / 2) + 1;
    const input = lyingEntry('input1.in', half, 16);
    const output = lyingEntry('output1.out', half, 16);
    (unzipper.Open.custom as jest.Mock).mockResolvedValueOnce({ files: [input.file, output.file] });

    const result = replaceProblemTestcasesFromZipFile('P1', '/tmp/assembled-testcases.zip');

    await expect(result).rejects.toMatchObject({
      statusCode: 400,
      message: `Archive rejected: uncompressed size exceeds ${ARCHIVE_LIMITS.MAX_UNCOMPRESSED_BYTES} bytes (decompression bomb).`,
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
