import { act, renderHook, waitFor } from '@testing-library/react';
import { useIncrementalProblems } from '../../hooks/useIncrementalProblems';
import problemService from '../../services/problemService';

jest.mock('../../services/problemService');
jest.mock('../../config/constants', () => ({
  PROBLEMS_PAGE: { PAGE_SIZE: 20, SEARCH_DEBOUNCE_MS: 300 },
}));

const firstPage = {
  problems: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, title: `P${i}` })),
  nextCursor: 'cursor-1',
  hasMore: true,
};

describe('useIncrementalProblems', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('fetches the first batch on mount with the page size limit', async () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValueOnce(firstPage);

        const { result } = renderHook(() => useIncrementalProblems({}));

        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(problemService.getProblemsPage).toHaveBeenCalledWith({ limit: 20 });
        expect(result.current.problems).toEqual(firstPage.problems);
        expect(result.current.hasMore).toBe(true);
        expect(result.current.nextCursor).toBe('cursor-1');
        expect(result.current.error).toBe('');
    });

    it('Show More appends the next batch and keeps the cursor chain', async () => {
        const secondPage = {
            problems: [{ id: 'p20', title: 'P20' }],
            nextCursor: null,
            hasMore: false,
        };
        (jest.mocked(problemService.getProblemsPage) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(secondPage);

        const { result } = renderHook(() => useIncrementalProblems({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            result.current.loadMore();
        });

        expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ limit: 20, cursor: 'cursor-1' });
        expect(result.current.problems.map(p => p.id)).toEqual([...firstPage.problems.map(p => p.id), 'p20']);
        expect(result.current.hasMore).toBe(false);
        expect(result.current.nextCursor).toBeNull();
    });

    it('a double-click spam fires a single request for the next batch', async () => {
        let resolveSecond: (value: unknown) => void = () => { };
        const pendingSecond = new Promise(resolve => { resolveSecond = resolve; });
        (jest.mocked(problemService.getProblemsPage) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockReturnValueOnce(pendingSecond);

        const { result } = renderHook(() => useIncrementalProblems({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.loadMore();
            result.current.loadMore();
            result.current.loadMore();
        });

        // The in-flight guard collapses the spam into one request.
        expect(problemService.getProblemsPage).toHaveBeenCalledTimes(2);

        await act(async () => {
            resolveSecond({ problems: [{ id: 'p20' }], nextCursor: null, hasMore: false });
            await pendingSecond;
        });
        await waitFor(() => expect(result.current.problems).toHaveLength(21));
    });

    it('resets the list (never appends) when the query changes', async () => {
        const filteredPage = {
            problems: [{ id: 'graph-1', title: 'Graph One' }],
            nextCursor: null,
            hasMore: false,
        };
        (jest.mocked(problemService.getProblemsPage) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(filteredPage);

        const { result, rerender } = renderHook(
            ({ query }: { query: { search?: string } }) => useIncrementalProblems(query),
            { initialProps: { query: {} as { search?: string } } },
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.problems).toHaveLength(20);

        rerender({ query: { search: 'graph' } });

        await waitFor(() => expect(result.current.problems.map(p => p.id)).toEqual(['graph-1']));
        expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ search: 'graph', limit: 20 });
        expect(result.current.hasMore).toBe(false);
    });

    it('ignores a stale first-page response that lands after a newer query', async () => {
        let resolveOld: (value: unknown) => void = () => { };
        const oldQuery = new Promise(resolve => { resolveOld = resolve; });
        (jest.mocked(problemService.getProblemsPage) as jest.Mock)
            .mockReturnValueOnce(oldQuery) // slow first query
            .mockResolvedValueOnce({ problems: [{ id: 'new-1' }], nextCursor: null, hasMore: false });

        const { result, rerender } = renderHook(
            ({ query }: { query: { search?: string } }) => useIncrementalProblems(query),
            { initialProps: { query: {} as { search?: string } } },
        );

        rerender({ query: { search: 'fast' } });
        await waitFor(() => expect(result.current.problems.map(p => p.id)).toEqual(['new-1']));

        // The slow earlier response arrives late — it must be discarded.
        await act(async () => {
            resolveOld({ problems: [{ id: 'stale-1' }], nextCursor: null, hasMore: false });
            await oldQuery;
        });
        expect(result.current.problems.map(p => p.id)).toEqual(['new-1']);
    });

    it('a Show More failure keeps the loaded list and exposes a retry', async () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({ problems: [{ id: 'p20' }], nextCursor: null, hasMore: false });

        const { result } = renderHook(() => useIncrementalProblems({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            result.current.loadMore();
        });

        expect(result.current.loadMoreError).toBe(true);
        expect(result.current.problems).toHaveLength(20); // list untouched
        expect(result.current.hasMore).toBe(true); // cursor preserved for retry

        await act(async () => {
            result.current.loadMore(); // Retry
        });
        expect(result.current.loadMoreError).toBe(false);
        expect(result.current.problems).toHaveLength(21);
    });

    it('a first-page failure surfaces the error without stale list content', async () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock)
            .mockRejectedValueOnce(new Error('fetch failed'));

        const { result } = renderHook(() => useIncrementalProblems({}));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('Failed to fetch problems.');
        expect(result.current.problems).toEqual([]);
    });

    it('dedupes by problem id on append (defensive against cursor drift)', async () => {
        const duplicatedSecondPage = {
            problems: [{ id: 'p20' }, { id: 'p5' }, { id: 'p21' }],
            nextCursor: null,
            hasMore: false,
        };
        (jest.mocked(problemService.getProblemsPage) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(duplicatedSecondPage);

        const { result } = renderHook(() => useIncrementalProblems({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            result.current.loadMore();
        });

        expect(result.current.problems.map(p => p.id)).toEqual([
            ...firstPage.problems.map(p => p.id), 'p20', 'p21',
        ]);
    });
});
