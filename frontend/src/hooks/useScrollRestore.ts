import { useEffect } from 'react';

const storageKey = 'oj-problems-scroll';

/**
 * Persists the window scroll position of the current page and restores it on
 * return navigation (e.g. browser Back from a detail page), instead of always
 * landing back at the top of the list.
 *
 * The position is saved when the component unmounts and when the user leaves
 * the tab (covers reload and forward navigation). Restoration runs once after
 * the data-driven content has rendered.
 */
export function useScrollRestore(ready: boolean): void {
  // Save on unmount and on pagehide (reload/tab close).
  useEffect(() => {
    const save = () => {
      try {
        window.sessionStorage.setItem(storageKey, String(window.scrollY));
      } catch {
        // Storage can be unavailable (private mode); scroll restore is best-effort.
      }
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, []);

  // Restore once the list content is rendered, so the browser can scroll past it.
  useEffect(() => {
    if (!ready) return;
    let saved = 0;
    try {
      saved = Number(window.sessionStorage.getItem(storageKey)) || 0;
      window.sessionStorage.removeItem(storageKey);
    } catch {
      return;
    }
    if (saved > 0) {
      // Two frames: one for layout, one for the fonts/images that shift it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.scrollTo({ top: saved });
        })
      );
    }
  }, [ready]);
}
