import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const keyFor = (locationKey: string) => `oj.scroll:${locationKey}`;

/**
 * Remembers how far a list page was scrolled (per history entry) and, on Back
 * or Forward, returns there once its rows have loaded. Lists that load after
 * render (submissions) need this; the router's own restoration runs before
 * the rows exist, while the page is still short.
 */
export function useRestoreScroll(ready: boolean): void {
  const { key } = useLocation();
  const navigationType = useNavigationType();
  const storageKey = keyFor(key);

  useEffect(() => {
    const save = () => {
      try { sessionStorage.setItem(storageKey, String(Math.round(window.scrollY))); } catch { /* storage unavailable */ }
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [storageKey]);

  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    if (navigationType !== 'POP') return;
    let saved = 0;
    try { saved = Number(sessionStorage.getItem(storageKey)); } catch { /* storage unavailable */ }
    if (saved > 0) window.scrollTo(0, saved);
  }, [ready, navigationType, storageKey]);
}
