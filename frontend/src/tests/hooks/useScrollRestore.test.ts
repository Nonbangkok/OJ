import { renderHook } from '@testing-library/react';
import { useScrollRestore } from '../../hooks/useScrollRestore';

describe('useScrollRestore', () => {
    const originalScrollTo = window.scrollTo;
    const originalScrollY = window.scrollY;

    afterEach(() => {
        window.scrollTo = originalScrollTo;
        Object.defineProperty(window, 'scrollY', { value: originalScrollY, writable: true, configurable: true });
        window.sessionStorage.clear();
    });

    it('does not scroll when nothing was saved', async () => {
        window.scrollTo = jest.fn();
        const { rerender } = renderHook(({ ready }) => useScrollRestore(ready), {
            initialProps: { ready: false },
        });

        rerender({ ready: true });
        await nextFrames();

        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('restores the saved scroll position once the page is ready', async () => {
        window.scrollTo = jest.fn();
        window.sessionStorage.setItem('oj-problems-scroll', '1200');
        const { rerender } = renderHook(({ ready }) => useScrollRestore(ready), {
            initialProps: { ready: false },
        });

        rerender({ ready: true });
        await nextFrames();

        expect(window.scrollTo).toHaveBeenCalledWith({ top: 1200 });
        expect(window.sessionStorage.getItem('oj-problems-scroll')).toBeNull();
    });

    it('saves the scroll position on unmount', () => {
        window.scrollTo = jest.fn();
        Object.defineProperty(window, 'scrollY', { value: 340, writable: true, configurable: true });
        const { unmount } = renderHook(() => useScrollRestore(true));

        unmount();

        expect(window.sessionStorage.getItem('oj-problems-scroll')).toBe('340');
    });
});

/** Resolves after the hook's two nested requestAnimationFrame frames have run. */
function nextFrames(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
