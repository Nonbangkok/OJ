import { toCsv } from '../../utils/downloadCsv';

describe('toCsv', () => {
  it('quotes cells with commas, quotes or newlines', () => {
    expect(toCsv([['a', 'b,c'], ['say "hi"', 'x\ny']])).toBe('a,"b,c"\n"say ""hi""","x\ny"');
  });

  it('neutralises cells a spreadsheet would run as a formula', () => {
    // A self-registered username like =HYPERLINK(...) must stay text in Excel/Sheets.
    expect(toCsv([['=HYPERLINK("http://x","open")', '+1', '-2', '@SUM(A1)', '\tx', '\rx', 'safe']]))
      .toBe('"\'=HYPERLINK(""http://x"",""open"")",\'+1,\'-2,\'@SUM(A1),\'\tx,"\'\rx",safe');
  });
});
