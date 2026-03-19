import { renderHook, act, waitFor } from '@testing-library/react';
import { useAutocomplete } from '../../hooks/useAutocomplete';

describe('useAutocomplete', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns initial state', () => {
        const fetchFn = jest.fn();
        const { result } = renderHook(() => useAutocomplete(fetchFn));

        expect(result.current.query).toBe('');
        expect(result.current.suggestions).toEqual([]);
        expect(result.current.showSuggestions).toBe(false);
    });

    it('updates query and fetches suggestions on handleChange', async () => {
        const mockSuggestions = [{ id: 1, title: 'Problem 1' }];
        const fetchFn = jest.fn().mockResolvedValue(mockSuggestions);

        const { result } = renderHook(() => useAutocomplete(fetchFn));

        await act(async () => {
            result.current.handleChange({ target: { value: 'prob' } });
        });

        expect(result.current.query).toBe('prob');
        expect(fetchFn).toHaveBeenCalledWith('prob');

        await waitFor(() => {
            expect(result.current.suggestions).toEqual(mockSuggestions);
            expect(result.current.showSuggestions).toBe(true);
        });
    });

    it('hides suggestions when query is empty', async () => {
        const fetchFn = jest.fn().mockResolvedValue([]);

        const { result } = renderHook(() => useAutocomplete(fetchFn));

        await act(async () => {
            result.current.handleChange({ target: { value: 'a' } });
        });
        await waitFor(() => expect(result.current.showSuggestions).toBe(true));

        await act(async () => {
            result.current.handleChange({ target: { value: '' } });
        });

        expect(result.current.query).toBe('');
        expect(result.current.showSuggestions).toBe(false);
    });

    it('select updates query and hides suggestions', () => {
        const fetchFn = jest.fn();
        const { result } = renderHook(() => useAutocomplete(fetchFn));

        act(() => {
            result.current.select('selected-value');
        });

        expect(result.current.query).toBe('selected-value');
        expect(result.current.showSuggestions).toBe(false);
    });

    it('setQuery updates query', () => {
        const fetchFn = jest.fn();
        const { result } = renderHook(() => useAutocomplete(fetchFn));

        act(() => {
            result.current.setQuery('new-query');
        });

        expect(result.current.query).toBe('new-query');
    });

    it('setShowSuggestions updates showSuggestions', () => {
        const fetchFn = jest.fn();
        const { result } = renderHook(() => useAutocomplete(fetchFn));

        act(() => {
            result.current.setShowSuggestions(true);
        });

        expect(result.current.showSuggestions).toBe(true);
    });

    it('handles fetch error gracefully', async () => {
        const fetchFn = jest.fn().mockRejectedValue(new Error('Fetch failed'));

        const { result } = renderHook(() => useAutocomplete(fetchFn));

        await act(async () => {
            result.current.handleChange({ target: { value: 'error' } });
        });

        expect(result.current.query).toBe('error');
        expect(fetchFn).toHaveBeenCalledWith('error');
        // On error, suggestions stay empty and showSuggestions stays false (or doesn't update)
        expect(result.current.suggestions).toEqual([]);
    });
});
