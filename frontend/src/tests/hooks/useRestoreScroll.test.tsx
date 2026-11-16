import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRestoreScroll } from '../../hooks/useRestoreScroll';

/** Rows carry data-row-key (as DataTable rows do); `tops` fakes where each row sits in the viewport. */
function List({ ready, rows }: { ready: boolean; rows: string[] }) {
  useRestoreScroll(ready);
  return <ul>{ready && rows.map((r) => <li key={r} data-row-key={r}>{r}</li>)}</ul>;
}
const ENTRY = [{ pathname: '/submissions', key: 'entry-1' }];
const page = (ready: boolean, rows: string[]) => <MemoryRouter initialEntries={ENTRY}><List ready={ready} rows={rows} /></MemoryRouter>;
let tops: Record<string, number> = {};
const setScroll = (y: number) => { (window as { scrollY: number }).scrollY = y; };

describe('useRestoreScroll', () => {
  beforeEach(() => {
    sessionStorage.clear();
    tops = {};
    setScroll(0);
    window.scrollTo = jest.fn((_x: number, y: number) => setScroll(y)) as never;
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = tops[this.dataset.rowKey ?? ''] ?? 9999;
      return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns to the same row on Back, even when new submissions were added above it', () => {
    const first = render(page(true, ['s9', 's8', 's7', 's6']));
    // Scrolled so s7 sits 12px below the top of the viewport.
    tops = { s9: -68, s8: -28, s7: 12, s6: 52 };
    act(() => { setScroll(840); fireEvent.scroll(window); });
    first.unmount();

    setScroll(0);
    const back = render(page(false, []));
    // Two new 40px rows pushed s7 down: at scrollY 0 it now sits at 852 + 80.
    tops = { s11: 0, s10: 40, s9: 772 + 80, s8: 812 + 80, s7: 852 + 80, s6: 892 + 80 };
    back.rerender(page(true, ['s11', 's10', 's9', 's8', 's7', 's6']));
    // The anchor is the first row still on screen (s8 at -28 … bottom 12 > 0), so s8 returns to -28: y = 892 + 28.
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 920);
  });

  it('a clamped scroll while the page is still empty does not overwrite the saved place', () => {
    const first = render(page(true, ['a', 'b']));
    tops = { a: -20, b: 20 };
    act(() => { setScroll(600); fireEvent.scroll(window); });
    first.unmount();

    const back = render(page(false, []));
    // The router restores before the rows exist; the short page clamps it to 0.
    act(() => { setScroll(0); fireEvent.scroll(window); });
    // At scrollY 0 the rows sit at their page positions: a at 580, b at 620.
    tops = { a: 580, b: 620 };
    back.rerender(page(true, ['a', 'b']));
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 600);
  });

  it('falls back to the pixel position when the remembered row is gone', () => {
    const first = render(page(true, ['x']));
    tops = { x: 5 };
    act(() => { setScroll(300); fireEvent.scroll(window); });
    first.unmount();
    const back = render(page(false, []));
    back.rerender(page(true, ['y', 'z']));
    expect(window.scrollTo).toHaveBeenCalledWith(0, 300);
  });

  it('restores only once, so later refreshes never yank the page back', () => {
    sessionStorage.setItem('oj.scroll:entry-1', JSON.stringify({ y: 500 }));
    const view = render(page(true, ['a']));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    view.rerender(page(true, ['b', 'a']));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });
});
