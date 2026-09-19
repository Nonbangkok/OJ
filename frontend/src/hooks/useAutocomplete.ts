import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ProblemSuggestion, UserSuggestion } from '../types';

type AutocompleteSuggestion = ProblemSuggestion | UserSuggestion;
type SearchFn<T> = (
  query: string,
  ...extra: (string | number | null | undefined)[]
) => Promise<T[]>;

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

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (value.length > 0) {
      try {
        // Pass extraParams (like contestId) if they exist
        const params = Object.values(extraParams).some((v) => v !== null)
          ? Object.values(extraParams)
          : [];
        const data = await fetchFn(value, ...params);
        setSuggestions(data);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Autocomplete fetch error:', err);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  const select = (value: string) => {
    setQuery(value);
    setShowSuggestions(false);
  };

  return {
    query,
    setQuery,
    suggestions,
    showSuggestions,
    setShowSuggestions,
    handleChange,
    select,
  };
};
