import { useState, ChangeEvent } from 'react';

interface AutocompleteExtraParams {
    [key: string]: string | number | null | undefined;
}

interface UseAutocompleteReturn<T> {
    query: string;
    setQuery: (query: string) => void;
    suggestions: T[];
    showSuggestions: boolean;
    setShowSuggestions: (show: boolean) => void;
    handleChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
    select: (value: string) => void;
}

/**
 * Generic autocomplete hook for search inputs with suggestions.
 * @param {Function} fetchFn - Async function that takes a query string and returns suggestions
 */
export const useAutocomplete = <T>(
    fetchFn: (query: string, ...args: any[]) => Promise<T[]>,
    extraParams: AutocompleteExtraParams = {}
): UseAutocompleteReturn<T> => {
    const [query, setQuery] = useState<string>('');
    const [suggestions, setSuggestions] = useState<T[]>([]);
    const [showSuggestions, setShowSuggestions] = useState<boolean>(false);

    const handleChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const value = e.target.value;
        setQuery(value);
        if (value.length > 0) {
            try {
                // Pass extraParams (like contestId) if they exist
                const params = Object.values(extraParams).filter(v => v !== null && v !== undefined);
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

    const select = (value: string): void => {
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
