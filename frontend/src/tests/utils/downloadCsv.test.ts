import { toCsv } from '../../utils/downloadCsv';

describe('toCsv', () => {
  it('quotes cells with commas, quotes or newlines', () => {
    expect(toCsv([['a', 'b,c'], ['say "hi"', 'x\ny']])).toBe('a,"b,c"\n"say ""hi""","x\ny"');
  });
});
