import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { ProblemSuggestion, UserSuggestion } from '../types';

type AutocompleteSuggestion = ProblemSuggestion | UserSuggestion;
type SearchFn<T> = (
  query: string,
  ...extra: (string | number | null | undefined)[]
) => Promise<T[]>;

const AUTOCOMPLETE_DEBOUNCE_MS = 300;

/**
 * Generic autocomplete hook for search inputs with suggestions.
 * @param {Function} fetchFn - Async function that takes a query string and returns suggestions
 */
export const useAutocomplete = <T extends AutocompleteSuggestion>(
  fetchFn: SearchFn<T>,
  extraParams: Record<string, string | number | null | undefined> = {}
) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const queryRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const extraParamsRef = useRef(extraParams);
  const extraParamsKey = JSON.stringify(Object.entries(extraParams));
  const extraParamsKeyRef = useRef(extraParamsKey);
  extraParamsRef.current = extraParams;
  extraParamsKeyRef.current = extraParamsKey;

  const cancelPending = useCallback(() => {
    requestIdRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const updateQuery = useCallback((nextValue: string) => {
    queryRef.current = nextValue;
    setQuery(nextValue);
    cancelPending();
    setSuggestions([]);
    setShowSuggestions(false);
    if (!nextValue) return;

    const requestId = requestIdRef.current;
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      try {
        // Pass extraParams (like contestId) if they exist.
        const currentExtraParams = extraParamsRef.current;
        const params = Object.values(currentExtraParams).some((v) => v !== null)
          ? Object.values(currentExtraParams)
          : [];
        const data = await fetchFn(nextValue, ...params);
        if (requestId === requestIdRef.current
          && queryRef.current === nextValue
          && extraParamsKey === extraParamsKeyRef.current) {
          setSuggestions(data);
          setShowSuggestions(true);
        }
      } catch (err) {
        if (requestId === requestIdRef.current && extraParamsKey === extraParamsKeyRef.current) {
          console.error('Autocomplete fetch error:', err);
        }
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }, [cancelPending, extraParamsKey, fetchFn]);

  const setQueryValue: Dispatch<SetStateAction<string>> = useCallback((value) => {
    const nextValue = typeof value === 'function' ? value(queryRef.current) : value;
    updateQuery(nextValue);
  }, [updateQuery]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => updateQuery(e.target.value);

  const select = (value: string) => {
    cancelPending();
    queryRef.current = value;
    setQuery(value);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  useEffect(() => () => cancelPending(), [cancelPending]);

  // A contextual filter (for example contestId) can change without the input
  // unmounting. Invalidate pending work and remove suggestions from the old
  // context rather than allowing them to flash into the new one.
  const previousExtraParamsKeyRef = useRef(extraParamsKey);
  useEffect(() => {
    if (previousExtraParamsKeyRef.current === extraParamsKey) return;
    previousExtraParamsKeyRef.current = extraParamsKey;
    cancelPending();
    setSuggestions([]);
    setShowSuggestions(false);
    // Preserve the current query and look it up in the new context; this does
    // not touch the input's DOM node or its caret position.
    if (queryRef.current) updateQuery(queryRef.current);
  }, [cancelPending, extraParamsKey, updateQuery]);

  return {
    query,
    setQuery: setQueryValue,
    suggestions,
    showSuggestions,
    setShowSuggestions,
    handleChange,
    select,
  };
};
