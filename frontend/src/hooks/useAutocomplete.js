import { useState } from 'react';

/**
 * Generic autocomplete hook for search inputs with suggestions.
 * @param {Function} fetchFn - Async function that takes a query string and returns suggestions
 */
export const useAutocomplete = (fetchFn) => {
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const handleChange = async (e) => {
        const value = e.target.value;
        setQuery(value);
        if (value.length > 0) {
            try {
                const data = await fetchFn(value);
                setSuggestions(data);
                setShowSuggestions(true);
            } catch (err) {
                console.error('Autocomplete fetch error:', err);
            }
        } else {
            setShowSuggestions(false);
        }
    };

    const select = (value) => {
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
