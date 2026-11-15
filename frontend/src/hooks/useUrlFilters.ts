import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filter values kept in the URL. Empty values are removed and updates
 * replace the history entry, so typing does not flood the back button.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]): {
  values: Record<K, string>;
  /** One change. Two `set` calls in one handler keep only the last; use `setMany` for that. */
  set: (key: K, value: string | null) => void;
  /** Several changes in one URL update (e.g. a filter plus a page reset). */
  setMany: (patch: Partial<Record<K, string | null>>) => void;
  clear: () => void;
} {
  const [params, setParams] = useSearchParams();
  const keyList = keys.join('\u0000');

  const values = useMemo(
    () => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>,
    // keyList stands in for keys (a new array each render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, keyList],
  );

  const setMany = useCallback((patch: Partial<Record<K, string | null>>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch) as Array<[K, string | null | undefined]>) {
        if (value === undefined) continue;
        if (value === null || value === '') next.delete(key); else next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const set = useCallback((key: K, value: string | null) => {
    setMany({ [key]: value } as Partial<Record<K, string | null>>);
  }, [setMany]);

  const clear = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      keyList.split('\u0000').forEach((k) => next.delete(k));
      return next;
    }, { replace: true });
  }, [setParams, keyList]);

  return { values, set, setMany, clear };
}

export default useUrlFilters;
