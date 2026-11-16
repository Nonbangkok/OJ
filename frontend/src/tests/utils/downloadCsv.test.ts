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

describe('downloadCsv', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('writes a UTF-8 BOM so Excel reads Thai text, clicks an attached link and revokes the URL only afterwards', async () => {
    jest.useFakeTimers();
    let blob: Blob | null = null;
    const create = jest.fn((b: Blob) => { blob = b; return 'blob:csv'; });
    const revoke = jest.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let attachedOnClick = false;
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      attachedOnClick = document.body.contains(this);
    });
    const { downloadCsv } = await import('../../utils/downloadCsv');
    downloadCsv('top.csv', [['title'], ['บวกเลข']]);
    expect(attachedOnClick).toBe(true);
    expect(revoke).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:csv');
    expect(document.querySelector('a[download]')).toBeNull();
    const bytes = new Uint8Array(await new Response(blob!).arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });
});
