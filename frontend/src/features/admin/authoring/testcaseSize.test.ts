import { formatByteSize } from './testcaseSize';

describe('formatByteSize', () => {
  it('renders MB with two decimals for typical testcase sizes', () => {
    expect(formatByteSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatByteSize(15 * 1024 * 1024 + 300 * 1024)).toBe('15.29 MB');
  });

  it('switches to KB below 0.1 MB so small cases never show as 0.0 MB', () => {
    expect(formatByteSize(0.099 * 1024 * 1024)).toBe('101 KB');
    expect(formatByteSize(4096)).toBe('4 KB');
    expect(formatByteSize(0)).toBe('1 KB');
  });

  it('uses one decimal past 100 MB to keep the column narrow', () => {
    expect(formatByteSize(250 * 1024 * 1024)).toBe('250.0 MB');
  });
});
