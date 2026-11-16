import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const keyFor = (locationKey: string) => `oj.scroll:${locationKey}`;
/** Late layout (fonts, a toast, rows streaming in) can shift the page after the first restore; re-apply for this long. */
const SETTLE_DELAYS_MS = [50, 150, 300, 600, 1000];

interface Saved { y: number; row?: string; offset?: number }

/** The first list row still on screen, and how far below the viewport top it starts. */
function anchorRow(): { row: string; offset: number } | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-row-key]')) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0) return { row: el.dataset.rowKey ?? '', offset: rect.top };
  }
  return null;
}

function targetFor(saved: Saved): number {
  if (saved.row !== undefined && saved.offset !== undefined) {
    const el = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(saved.row)}"]`);
    if (el) return Math.max(0, Math.round(window.scrollY + el.getBoundingClientRect().top - saved.offset));
  }
  return saved.y;
}

const read = (storageKey: string): Saved | null => {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Saved;
    return Number.isFinite(value?.y) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Remembers where a list page was scrolled (per history entry) and, on Back or
 * Forward, returns there once its rows have loaded.
 *
 * It remembers the first row on screen (rows carry `data-row-key`, as
 * DataTable rows do) and its offset, not just a pixel position, so rows added
 * above it meanwhile (a live feed) do not shift where you land. Nothing is
 * saved until the restore is done: on return the router's own restoration runs
 * while the page is still short, and its clamped scroll must not overwrite the
 * place being restored.
 */
export function useRestoreScroll(ready: boolean): void {
  const { key } = useLocation();
  const navigationType = useNavigationType();
  const storageKey = keyFor(key);
  const settled = useRef(false);

  useEffect(() => {
    const save = () => {
      if (!settled.current) return;
      const anchor = anchorRow();
      const value: Saved = { y: Math.round(window.scrollY), ...(anchor ?? {}) };
      try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* storage unavailable */ }
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [storageKey]);

  useEffect(() => {
    if (!ready || settled.current) return undefined;
    const saved = navigationType === 'POP' ? read(storageKey) : null;
    if (!saved) {
      settled.current = true;
      return undefined;
    }
    window.scrollTo(0, targetFor(saved));

    // Keep the row in place while late layout settles, unless the reader takes over.
    let stopped = false;
    const stop = () => { stopped = true; };
    const timers = SETTLE_DELAYS_MS.map((delay) => window.setTimeout(() => {
      if (stopped) return;
      const target = targetFor(saved);
      if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
    }, delay));
    const done = window.setTimeout(() => { settled.current = true; cleanup(); }, SETTLE_DELAYS_MS[SETTLE_DELAYS_MS.length - 1] + 50);
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    events.forEach((name) => window.addEventListener(name, stop, { passive: true }));
    function cleanup() {
      events.forEach((name) => window.removeEventListener(name, stop));
    }
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(done);
      cleanup();
      settled.current = true;
    };
  }, [ready, navigationType, storageKey]);
}
