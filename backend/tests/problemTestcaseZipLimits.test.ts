import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import * as db from '../db';
import { replaceProblemTestcasesFromZip, replaceProblemTestcasesFromZipFile } from '../services/problemQueryService';

jest.mock('../db');

// The single-problem testcase routes (one-request upload and the chunked,
// disk-backed one) read every paired entry with entry.buffer(), so an entry
// whose declared size lies inflated without bound. These tests use the real
// unzipper on real archives: a lying entry is refused after its first chunk,
// and a refused disk-backed archive leaves no descriptor open on the file.

const MiB = 1024 * 1024;

type StoredEntry = { name: string; data: Buffer; declared?: number };

/** A ZIP of stored (uncompressed) entries; `declared` overrides the uncompressedSize both headers state. */
function storedZip(entries: StoredEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data, declared = data.length } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    const localPart = Buffer.concat([local, nameBuf, data]);
    locals.push(localPart);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += localPart.length;
  }
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralPart, eocd]);
}

/** How many of this process's descriptors refer to `file` (matched by device + inode). */
function openDescriptorsOn(file: string): number {
  const { dev, ino } = fs.statSync(file);
  let count = 0;
  for (let fd = 0; fd < 4096; fd += 1) {
    try {
      const stat = fs.fstatSync(fd);
      if (stat.dev === dev && stat.ino === ino) count += 1;
    } catch {
      // not an open descriptor
    }
  }
  return count;
}

const lyingPair = (): Buffer => storedZip([
  { name: 'input1.in', data: Buffer.alloc(8 * MiB, 0x31), declared: 100 },
  { name: 'output1.out', data: Buffer.from('3\n') },
]);

describe('single-problem testcase ZIPs on real archives', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-testcase-zip-limits-'));
    (db.query as jest.Mock).mockResolvedValue({ rows: [{ id: 'P1' }], rowCount: 1 });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a disk-backed entry that is larger than it declares and closes the archive file', async () => {
    const zipPath = path.join(dir, 'testcases.zip');
    fs.writeFileSync(zipPath, lyingPair());

    await expect(replaceProblemTestcasesFromZipFile('P1', zipPath)).rejects.toMatchObject({
      statusCode: 400,
      message: 'ZIP entry "input1.in" does not match its declared size.',
    });

    expect(openDescriptorsOn(zipPath)).toBe(0);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('refuses the same entry from a single-request upload', async () => {
    await expect(replaceProblemTestcasesFromZip('P1', lyingPair())).rejects.toMatchObject({
      statusCode: 400,
      message: 'ZIP entry "input1.in" does not match its declared size.',
    });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('still imports an honest disk-backed archive and closes the file', async () => {
    const zipPath = path.join(dir, 'testcases.zip');
    const input = Buffer.alloc(2 * MiB, 0x32);
    fs.writeFileSync(zipPath, storedZip([
      { name: 'input1.in', data: input },
      { name: 'output1.out', data: Buffer.from('4\n') },
    ]));
    const clientQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    (db.pool.connect as jest.Mock).mockResolvedValueOnce({ query: clientQuery, release: jest.fn() });

    await expect(replaceProblemTestcasesFromZipFile('P1', zipPath)).resolves.toEqual({ kind: 'ok', insertedCount: 1 });

    expect(clientQuery).toHaveBeenCalledWith(
      'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
      ['P1', 1, input.toString('utf-8'), '4\n'],
    );
    expect(openDescriptorsOn(zipPath)).toBe(0);
  });
});
