import { EventEmitter } from 'events';
import { Readable } from 'stream';
import {
  createInflateBudget,
  readZipEntryBounded,
  ZipEntryLimitError,
  type ReadableZipEntry,
} from '../../utils/zipEntryReader';

const KiB = 1024;

/**
 * An entry whose stream yields `chunkCount` chunks of `chunkSize` bytes
 * (Infinity = never ends), recording how many chunks were pulled and whether
 * the stream was destroyed.
 */
const fakeEntry = (declared: number, chunkSize: number, chunkCount: number) => {
  let opened: Readable | undefined;
  const state = {
    pulled: 0,
    get destroyed(): boolean { return opened?.destroyed === true; },
  };
  const entry: ReadableZipEntry = {
    path: 'case.in',
    uncompressedSize: declared,
    stream: () => {
      opened = new Readable({
        highWaterMark: chunkSize,
        read() {
          if (state.pulled >= chunkCount) { this.push(null); return; }
          state.pulled += 1;
          this.push(Buffer.alloc(chunkSize, 0x61));
        },
      });
      return opened;
    },
  };
  return { entry, state };
};

describe('readZipEntryBounded', () => {
  it('returns the exact bytes of an honest entry and closes its stream', async () => {
    const { entry, state } = fakeEntry(3 * 16 * KiB, 16 * KiB, 3);
    const content = await readZipEntryBounded(entry, 1024 * KiB);
    expect(content.length).toBe(3 * 16 * KiB);
    expect(state.destroyed).toBe(true);
  });

  it('never opens an endless entry that declares more than the per-entry cap', async () => {
    const { entry, state } = fakeEntry(Number.MAX_SAFE_INTEGER, 16 * KiB, Infinity);
    await expect(readZipEntryBounded(entry, 64 * KiB))
      .rejects.toThrow(new ZipEntryLimitError(`ZIP entry "case.in" exceeds ${64 * KiB} bytes.`));
    expect(state.pulled).toBe(0);
  });

  it('stops reading an endless entry that declares a size within the cap one chunk past it', async () => {
    const { entry, state } = fakeEntry(64 * KiB, 16 * KiB, Infinity);
    await expect(readZipEntryBounded(entry, 64 * KiB))
      .rejects.toThrow(new ZipEntryLimitError('ZIP entry "case.in" does not match its declared size.'));
    // 4 chunks reach the declared size, the 5th crosses it; a couple more may
    // sit in the stream's read-ahead buffer, but reading never continues.
    expect(state.pulled).toBeLessThanOrEqual(8);
    expect(state.destroyed).toBe(true);
  });

  it('stops reading an entry as soon as it passes its declared size', async () => {
    const { entry, state } = fakeEntry(100, 16 * KiB, Infinity);
    await expect(readZipEntryBounded(entry, 64 * 1024 * KiB))
      .rejects.toThrow(new ZipEntryLimitError('ZIP entry "case.in" does not match its declared size.'));
    expect(state.pulled).toBeLessThanOrEqual(4);
    expect(state.destroyed).toBe(true);
  });

  it('enforces one running budget across the entries of an archive', async () => {
    // Honest entries whose declared sizes the caller did not total up front.
    const budget = createInflateBudget(100 * KiB);
    const first = fakeEntry(60 * KiB, 20 * KiB, 3);
    const second = fakeEntry(60 * KiB, 20 * KiB, 3);

    await expect(readZipEntryBounded(first.entry, 64 * KiB, budget)).resolves.toHaveLength(60 * KiB);
    await expect(readZipEntryBounded(second.entry, 64 * KiB, budget)).rejects.toThrow(
      `Archive rejected: uncompressed size exceeds ${100 * KiB} bytes (decompression bomb).`,
    );
    expect(second.state.pulled).toBe(0);
    expect(budget.usedBytes).toBe(60 * KiB);
  });

  it('charges the budget before inflating, so two reads in flight cannot both overrun it', async () => {
    const budget = createInflateBudget(100 * KiB);
    const first = fakeEntry(60 * KiB, 20 * KiB, 3);
    const second = fakeEntry(60 * KiB, 20 * KiB, 3);

    const results = await Promise.allSettled([
      readZipEntryBounded(first.entry, 64 * KiB, budget),
      readZipEntryBounded(second.entry, 64 * KiB, budget),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(second.state.pulled).toBe(0);
  });

  // A declared size above the per-entry cap or the budget left can never be
  // read successfully (real bytes must equal declared ones), so such an entry
  // is refused before its stream is opened. That also lets the reader
  // allocate the declared size once instead of collecting chunks and
  // concatenating them (two copies of the entry at the peak).
  it('refuses an entry declaring more than the per-entry cap without inflating it', async () => {
    const { entry, state } = fakeEntry(64 * KiB + 1, 16 * KiB, 5);
    await expect(readZipEntryBounded(entry, 64 * KiB))
      .rejects.toThrow(new ZipEntryLimitError(`ZIP entry "case.in" exceeds ${64 * KiB} bytes.`));
    expect(state.pulled).toBe(0);
  });

  it('refuses an entry declaring more than the archive budget has left without inflating it', async () => {
    const budget = createInflateBudget(100 * KiB);
    const first = fakeEntry(60 * KiB, 20 * KiB, 3);
    const second = fakeEntry(40 * KiB + 1, 20 * KiB, 3);

    await expect(readZipEntryBounded(first.entry, 64 * KiB, budget)).resolves.toHaveLength(60 * KiB);
    await expect(readZipEntryBounded(second.entry, 64 * KiB, budget)).rejects.toThrow(
      `Archive rejected: uncompressed size exceeds ${100 * KiB} bytes (decompression bomb).`,
    );
    expect(second.state.pulled).toBe(0);
  });

  it('refuses an entry whose declared size is not a byte count without inflating it', async () => {
    for (const declared of [-1, Number.NaN, 1.5]) {
      const { entry, state } = fakeEntry(declared, KiB, 2);
      await expect(readZipEntryBounded(entry, 64 * KiB))
        .rejects.toThrow(new ZipEntryLimitError('ZIP entry "case.in" does not match its declared size.'));
      expect(state.pulled).toBe(0);
    }
  });

  it('rejects an entry whose real size differs from the declared size', async () => {
    const shorter = fakeEntry(10 * KiB, KiB, 5);
    await expect(readZipEntryBounded(shorter.entry, 64 * KiB))
      .rejects.toThrow('ZIP entry "case.in" does not match its declared size.');

    const longer = fakeEntry(KiB, KiB, 5);
    await expect(readZipEntryBounded(longer.entry, 64 * KiB))
      .rejects.toBeInstanceOf(ZipEntryLimitError);
  });

  it('drops a decompressor error that reaches the entry after reading stopped', async () => {
    // Not a Node Readable, so nothing but the reader itself listens on it:
    // unzipper re-emits a late inflate error on the entry stream, and an
    // 'error' event without a listener would throw (in production: crash).
    let destroyed = false;
    const stream = Object.assign(new EventEmitter(), {
      destroy: () => { destroyed = true; },
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(KiB, 0x61);
        yield Buffer.alloc(KiB, 0x61);
      },
    });
    const entry: ReadableZipEntry = {
      path: 'case.in',
      uncompressedSize: 100,
      stream: () => stream as unknown as ReturnType<ReadableZipEntry['stream']>,
    };

    await expect(readZipEntryBounded(entry, 64 * KiB))
      .rejects.toThrow('ZIP entry "case.in" does not match its declared size.');
    expect(destroyed).toBe(true);
    expect(() => stream.emit('error', new Error('invalid stored block lengths'))).not.toThrow();
  });

  it('propagates a stream error and still closes the stream', async () => {
    let opened: Readable | undefined;
    const entry: ReadableZipEntry = {
      path: 'broken.in',
      uncompressedSize: 10,
      stream: () => {
        opened = new Readable({ read() { this.destroy(new Error('invalid stored block lengths')); } });
        return opened;
      },
    };
    await expect(readZipEntryBounded(entry, 64 * KiB)).rejects.toThrow('invalid stored block lengths');
    expect(opened?.destroyed).toBe(true);
  });
});
