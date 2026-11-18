import { readFlatZip } from '../../utils/headerProblemFiles';
import { HEADER_PROBLEM_LIMITS } from '../../constants';
import { countInflatedBytes, lyingZip } from '../fixtures/lyingZip';

// readFlatZip used to check the central directory's declared uncompressedSize
// and then call entry.buffer(), which inflates the whole entry into memory
// before the real length is checked. A 32 KiB ZIP whose entry declares 100
// bytes but inflates to 32 MiB was fully decompressed; the real-size guard
// must stop shortly after MAX_FILE_BYTES.

const MiB = 1024 * 1024;

describe('readFlatZip with a lying uncompressedSize', () => {
  it('rejects the entry without inflating far past the per-file cap', async () => {
    const actual = 32 * MiB;
    const zip = lyingZip('grader.cpp', actual, 100);
    expect(zip.length).toBeLessThan(64 * 1024);

    const { bytes, error } = await countInflatedBytes(() => readFlatZip(zip));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('ZIP entry "grader.cpp" does not match its declared size.');
    // Allow a few inflate chunks of overshoot past the 1 MiB cap.
    expect(bytes).toBeLessThan(HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES + 2 * MiB);
    // Reading stops once the entry passes its declared 100 bytes.
    expect(bytes).toBeLessThan(256 * 1024);
  });

  it('rejects an entry that inflates to less than it declares', async () => {
    await expect(readFlatZip(lyingZip('grader.cpp', 500, 1000)))
      .rejects.toThrow('ZIP entry "grader.cpp" does not match its declared size.');
  });

  it('rejects an entry under the cap that inflates to more than it declares', async () => {
    await expect(readFlatZip(lyingZip('grader.cpp', 4096, 100)))
      .rejects.toThrow('ZIP entry "grader.cpp" does not match its declared size.');
  });

  it('still reads an honest small entry', async () => {
    const zip = lyingZip('grader.cpp', 1000, 1000);
    const files = await readFlatZip(zip);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('grader.cpp');
    expect(files[0].content.length).toBe(1000);
  });

  it('reads an honest entry of exactly the per-file cap', async () => {
    const max = HEADER_PROBLEM_LIMITS.MAX_FILE_BYTES;
    const files = await readFlatZip(lyingZip('grader.cpp', max, max));
    expect(files[0].content.length).toBe(max);
  });
});
