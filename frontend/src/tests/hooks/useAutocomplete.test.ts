import { renderHook, act, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';

const changeEvent = (value: string) =>
    ({ target: { value } }) as unknown as ChangeEvent<HTMLInputElement>;
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

    it('debounces suggestion fetches while updating the query synchronously', async () => {
        const mockSuggestions = [{ id: 1, title: 'Problem 1' }];
        const fetchFn = jest.fn().mockResolvedValue(mockSuggestions);

        const { result } = renderHook(() => useAutocomplete(fetchFn));
        jest.useFakeTimers();
        act(() => {
            result.current.handleChange(changeEvent('prob'));
        });

        expect(result.current.query).toBe('prob');
        expect(fetchFn).not.toHaveBeenCalled();
        await act(async () => {
            jest.advanceTimersByTime(300);
            await Promise.resolve();
        });
        expect(fetchFn).toHaveBeenCalledWith('prob');
        expect(result.current.suggestions).toEqual(mockSuggestions);
        expect(result.current.showSuggestions).toBe(true);
        jest.useRealTimers();
    });

    it('hides suggestions when query is empty', async () => {
        const fetchFn = jest.fn().mockResolvedValue([]);

        const { result } = renderHook(() => useAutocomplete(fetchFn));

        jest.useFakeTimers();
        act(() => {
            result.current.handleChange(changeEvent('a'));
        });
        await act(async () => { jest.advanceTimersByTime(300); await Promise.resolve(); });
        await waitFor(() => expect(result.current.showSuggestions).toBe(true));

        act(() => {
            result.current.handleChange(changeEvent(''));
        });

        expect(result.current.query).toBe('');
        expect(result.current.showSuggestions).toBe(false);
        jest.useRealTimers();
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

    it('setQuery updates query and shares the debounce path', () => {
        const fetchFn = jest.fn();
        const { result } = renderHook(() => useAutocomplete(fetchFn));

        act(() => {
            result.current.setQuery('new-query');
        });

        expect(result.current.query).toBe('new-query');
        expect(fetchFn).not.toHaveBeenCalled();
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

        jest.useFakeTimers();
        act(() => {
            result.current.handleChange(changeEvent('error'));
        });
        await act(async () => { jest.advanceTimersByTime(300); await Promise.resolve(); });

        expect(result.current.query).toBe('error');
        expect(fetchFn).toHaveBeenCalledWith('error');
        // On error, suggestions stay empty and showSuggestions stays false (or doesn't update)
        expect(result.current.suggestions).toEqual([]);
        jest.useRealTimers();
    });

    it('ignores an older response that resolves after a newer query', async () => {
        let resolveOld: (value: unknown) => void = () => undefined;
        let resolveNew: (value: unknown) => void = () => undefined;
        const fetchFn = jest.fn()
            .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
            .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
        const { result } = renderHook(() => useAutocomplete(fetchFn));
        jest.useFakeTimers();

        act(() => result.current.handleChange(changeEvent('g')));
        await act(async () => { jest.advanceTimersByTime(300); });
        act(() => result.current.handleChange(changeEvent('graph')));
        await act(async () => { jest.advanceTimersByTime(300); });

        await act(async () => { resolveNew([{ id: 'graph', title: 'Graph' }]); });
        expect(result.current.suggestions).toEqual([{ id: 'graph', title: 'Graph' }]);
        await act(async () => { resolveOld([{ id: 'g', title: 'G' }]); });
        expect(result.current.suggestions).toEqual([{ id: 'graph', title: 'Graph' }]);
        jest.useRealTimers();
    });

    it('ignores suggestions returned for a stale extra-parameter context', async () => {
        let resolveContextRequest: (value: unknown) => void = () => undefined;
        const currentContextSuggestions = [{ id: 'new', title: 'Current contest problem' }];
        const fetchFn = jest.fn()
            .mockImplementationOnce(() => new Promise(resolve => { resolveContextRequest = resolve; }))
            .mockResolvedValueOnce(currentContextSuggestions);
        const { result, rerender } = renderHook(
            ({ contestId }) => useAutocomplete(fetchFn, { contestId }),
            { initialProps: { contestId: 10 } },
        );
        jest.useFakeTimers();

        act(() => result.current.handleChange(changeEvent('graph')));
        await act(async () => { jest.advanceTimersByTime(300); });
        expect(fetchFn).toHaveBeenCalledWith('graph', 10);

        rerender({ contestId: 20 });
        await act(async () => { resolveContextRequest([{ id: 'old', title: 'Old contest problem' }]); });
        expect(result.current.suggestions).toEqual([]);
        expect(result.current.showSuggestions).toBe(false);
        await act(async () => { jest.advanceTimersByTime(300); await Promise.resolve(); });
        expect(fetchFn).toHaveBeenLastCalledWith('graph', 20);
        expect(result.current.suggestions).toEqual(currentContextSuggestions);
        expect(result.current.showSuggestions).toBe(true);
        jest.useRealTimers();
    });
});
