import { useEffect, useState } from 'react';
import { getErrorStatus } from '../../utils/error';

interface Loaded<T> {
  key: string;
  attempt: number;
  data: T | null;
  error: unknown;
}

export interface LearnData<T> {
  data: T | null;
  loading: boolean;
  /** The request failed with 404 (missing, or hidden from this viewer). */
  notFound: boolean;
  failed: boolean;
  reload: () => void;
  /** Patch the loaded data locally (optimistic updates). */
  update: (patch: (current: T) => T) => void;
}

/**
 * Load `fetcher(key)` whenever `key` changes. Loading is derived from whether
 * the stored result belongs to the current key and attempt, so no state is set
 * synchronously in the effect. `fetcher` must be a stable (module-level) function.
 */
export function useLearnData<T>(key: string, fetcher: (key: string) => Promise<T>): LearnData<T> {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T>>({ key: '', attempt: -1, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetcher(key).then(
      (data) => { if (!cancelled) setLoaded({ key, attempt, data, error: null }); },
      (error: unknown) => { if (!cancelled) setLoaded({ key, attempt, data: null, error }); },
    );
    return () => { cancelled = true; };
  }, [key, attempt, fetcher]);

  const sameKey = loaded.key === key;
  const current = sameKey && loaded.attempt === attempt;
  const error = current ? loaded.error : null;
  return {
    data: sameKey ? loaded.data : null,
    loading: !current,
    notFound: error !== null && getErrorStatus(error) === 404,
    failed: error !== null && getErrorStatus(error) !== 404,
    reload: () => setAttempt((n) => n + 1),
    update: (patch) => setLoaded((state) => (state.data === null ? state : { ...state, data: patch(state.data) })),
  };
}
