import { countZipTestcases } from '../../../features/admin/problems/countZipTestcases';

/** A ZIP's central directory + end record — all countZipTestcases reads. */
const zipWithNames = (names: string[]): File => {
  const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const central: number[] = [];
  for (const name of names) {
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(0), ...u32(0), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0),
      ...enc(name));
  }
  const padding = new Array(10).fill(0); // stands in for local file data before the directory
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(names.length), ...u16(names.length),
    ...u32(central.length), ...u32(padding.length), ...u16(0)];
  return new File([new Uint8Array([...padding, ...central, ...end])], 'cases.zip', { type: 'application/zip' });
};

describe('countZipTestcases (mirror of backend testcaseZipPairing)', () => {
  it('counts numbers that have both an input and an output', async () => {
    const file = zipWithNames(['1.in', '1.out', '2.in', '2.out', 'input3.txt', 'output3.txt', '4.in', 'README.md', '__MACOSX/._1.in', 'dir/']);
    await expect(countZipTestcases(file)).resolves.toBe(3);
  });

  it('accepts .sol outputs and matches case-insensitively', async () => {
    await expect(countZipTestcases(zipWithNames(['01.IN', '1.sol', '2.in', '2.OUT']))).resolves.toBe(2);
  });

  it('returns null for something that is not a ZIP', async () => {
    await expect(countZipTestcases(new File(['not a zip at all'], 'x.zip'))).resolves.toBeNull();
  });
});
