import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRestoreScroll } from '../../hooks/useRestoreScroll';

function List({ ready }: { ready: boolean }) {
  useRestoreScroll(ready);
  return <p>list</p>;
}
// MemoryRouter's first render is a POP, which is what Back/Forward produce.
const show = (ready: boolean) => render(
  <MemoryRouter initialEntries={[{ pathname: '/submissions', key: 'entry-1' }]}>
    <List ready={ready} />
  </MemoryRouter>,
);

describe('useRestoreScroll', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.scrollTo = jest.fn();
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  it('remembers how far the list was scrolled and returns there on Back once the rows are in', () => {
    const first = show(true);
    act(() => { (window as { scrollY: number }).scrollY = 840; fireEvent.scroll(window); });
    first.unmount();

    const back = show(false);
    expect(window.scrollTo).not.toHaveBeenCalled(); // rows not loaded yet: nothing to scroll to
    back.rerender(
      <MemoryRouter initialEntries={[{ pathname: '/submissions', key: 'entry-1' }]}><List ready /></MemoryRouter>,
    );
    expect(window.scrollTo).toHaveBeenCalledWith(0, 840);
  });

  it('restores only once, so later refreshes never yank the page back', () => {
    sessionStorage.setItem('oj.scroll:entry-1', '500');
    const view = show(true);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    view.rerender(<MemoryRouter initialEntries={[{ pathname: '/submissions', key: 'entry-1' }]}><List ready /></MemoryRouter>);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });
});
