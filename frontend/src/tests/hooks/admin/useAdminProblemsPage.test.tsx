import { act, renderHook, waitFor } from '@testing-library/react';
import useAdminProblemsPage from '../../../hooks/admin/useAdminProblemsPage';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');
jest.mock('../../../config/constants', () => ({
  ADMIN_PROBLEMS_PAGE: { PAGE_SIZE: 25, SEARCH_DEBOUNCE_MS: 300 },
}));

const makeRow = (id: string) => ({ id, title: `T ${id}`, is_visible: true });
const firstPage = {
  problems: Array.from({ length: 25 }, (_, i) => makeRow(`p${String(i).padStart(2, '0')}`)),
  nextCursor: 'cursor-1',
  hasMore: true,
  authors: [{ name: 'admin' }],
  hasUnauthoredProblems: false,
  bulkEligibleCount: 100,
};

describe('useAdminProblemsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('fetches only the first batch on mount with the page size limit', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(firstPage);

        const { result } = renderHook(() => useAdminProblemsPage({}));

        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(adminService.getProblems).toHaveBeenCalledTimes(1);
        expect(adminService.getProblems).toHaveBeenCalledWith({ limit: 25 });
        expect(result.current.problems).toEqual(firstPage.problems);
        expect(result.current.hasMore).toBe(true);
        expect(result.current.authors).toEqual([{ name: 'admin' }]);
        expect(result.current.error).toBe('');
    });

    it('Show More appends the next batch and keeps existing rows', async () => {
        const secondPage = {
            problems: [makeRow('p25')],
            nextCursor: null,
            hasMore: false,
            authors: [{ name: 'admin' }],
            hasUnauthoredProblems: false,
            bulkEligibleCount: 100,
        };
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(secondPage);

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            result.current.loadMore();
        });

        expect(adminService.getProblems).toHaveBeenLastCalledWith({ limit: 25, cursor: 'cursor-1' });
        expect(result.current.problems.map(p => p.id)).toHaveLength(26);
        expect(result.current.problems[25].id).toBe('p25');
        expect(result.current.hasMore).toBe(false);
    });

    it('Load All follows every remaining cursor and dedupes overlapping rows', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('p25'), makeRow('p05')], nextCursor: 'cursor-2' })
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('p26')], nextCursor: null, hasMore: false });

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { await result.current.loadAll(); });

        expect((adminService.getProblems as jest.Mock).mock.calls).toEqual([
            [{ limit: 25 }],
            [{ limit: 100, cursor: 'cursor-1' }],
            [{ limit: 100, cursor: 'cursor-2' }],
        ]);
        expect(result.current.problems.map(problem => problem.id)).toEqual([
            ...firstPage.problems.map(problem => problem.id), 'p25', 'p26',
        ]);
        expect(result.current.hasMore).toBe(false);
        expect(result.current.loadingAll).toBe(false);
    });

    it('Load All resumes after Show More from the current cursor', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('p25')], nextCursor: 'cursor-2' })
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('p26')], nextCursor: null, hasMore: false });

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { result.current.loadMore(); });
        await act(async () => { await result.current.loadAll(); });

        expect((adminService.getProblems as jest.Mock).mock.calls[2][0]).toEqual({ limit: 100, cursor: 'cursor-2' });
        expect(result.current.problems).toHaveLength(27);
    });

    it('Load All uses the new filtered query after filters change', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('hidden-1')], nextCursor: 'hidden-cursor' })
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('hidden-2')], nextCursor: null, hasMore: false });

        const { result, rerender } = renderHook(
            ({ query }: { query: { visibility?: 'hidden' } }) => useAdminProblemsPage(query),
            { initialProps: { query: {} as { visibility?: 'hidden' } } },
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        rerender({ query: { visibility: 'hidden' } });
        await waitFor(() => expect(result.current.problems.map(problem => problem.id)).toEqual(['hidden-1']));
        await act(async () => { await result.current.loadAll(); });

        expect((adminService.getProblems as jest.Mock).mock.calls[2][0]).toEqual({ visibility: 'hidden', limit: 100, cursor: 'hidden-cursor' });
        expect(result.current.problems.map(problem => problem.id)).toEqual(['hidden-1', 'hidden-2']);
    });

    it('Load All retains completed pages and retries from the failed cursor', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('p25')], nextCursor: 'cursor-2' })
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('p26')], nextCursor: null, hasMore: false });

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { await result.current.loadAll(); });

        expect(result.current.problems).toHaveLength(26);
        expect(result.current.loadAllError).toBe(true);
        expect(result.current.hasMore).toBe(true);
        await act(async () => { await result.current.loadAll(); });

        expect((adminService.getProblems as jest.Mock).mock.calls[3][0]).toEqual({ limit: 100, cursor: 'cursor-2' });
        expect(result.current.problems).toHaveLength(27);
        expect(result.current.loadAllError).toBe(false);
    });

    it('ignores a Load All response after a filter change', async () => {
        let resolveOld: (value: unknown) => void = () => undefined;
        const oldPage = new Promise(resolve => { resolveOld = resolve; });
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockReturnValueOnce(oldPage)
            .mockResolvedValueOnce({ ...firstPage, problems: [makeRow('hidden-1')], nextCursor: null, hasMore: false });

        const { result, rerender } = renderHook(
            ({ query }: { query: { visibility?: 'hidden' } }) => useAdminProblemsPage(query),
            { initialProps: { query: {} as { visibility?: 'hidden' } } },
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => { void result.current.loadAll(); });
        rerender({ query: { visibility: 'hidden' } });
        await waitFor(() => expect(result.current.problems.map(problem => problem.id)).toEqual(['hidden-1']));
        await act(async () => {
            resolveOld({ ...firstPage, problems: [makeRow('stale')], nextCursor: null, hasMore: false });
            await oldPage;
        });
        expect(result.current.problems.map(problem => problem.id)).toEqual(['hidden-1']);
    });

    it('a double-click spam fires a single request for the next batch', async () => {
        let resolveSecond: (value: unknown) => void = () => { };
        const pendingSecond = new Promise(resolve => { resolveSecond = resolve; });
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockReturnValueOnce(pendingSecond);

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.loadMore();
            result.current.loadMore();
            result.current.loadMore();
        });

        expect(adminService.getProblems).toHaveBeenCalledTimes(2);

        await act(async () => {
            resolveSecond({ problems: [makeRow('p25')], nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false, bulkEligibleCount: 100 });
            await pendingSecond;
        });
        await waitFor(() => expect(result.current.problems).toHaveLength(26));
    });

    it('resets rows and cursor when the query changes (never appends across filters)', async () => {
        const filteredPage = {
            problems: [makeRow('hidden-1')],
            nextCursor: null,
            hasMore: false,
            authors: [{ name: 'admin' }],
            hasUnauthoredProblems: false,
            bulkEligibleCount: 5,
        };
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(filteredPage);

        const { result, rerender } = renderHook(
            ({ query }: { query: { visibility?: 'hidden' } }) => useAdminProblemsPage(query),
            { initialProps: { query: {} as { visibility?: 'hidden' } } },
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.problems).toHaveLength(25);

        rerender({ query: { visibility: 'hidden' } });

        await waitFor(() => expect(result.current.problems.map(p => p.id)).toEqual(['hidden-1']));
        expect(adminService.getProblems).toHaveBeenLastCalledWith({ visibility: 'hidden', limit: 25 });
        expect(result.current.hasMore).toBe(false);
    });

    it('ignores a stale first-page response that lands after a newer query', async () => {
        let resolveOld: (value: unknown) => void = () => { };
        const oldQuery = new Promise(resolve => { resolveOld = resolve; });
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockReturnValueOnce(oldQuery) // slow first query
            .mockResolvedValueOnce({ problems: [makeRow('new-1')], nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false, bulkEligibleCount: 1 });

        const { result, rerender } = renderHook(
            ({ query }: { query: { search?: string } }) => useAdminProblemsPage(query),
            { initialProps: { query: {} as { search?: string } } },
        );

        rerender({ query: { search: 'fast' } });
        await waitFor(() => expect(result.current.problems.map(p => p.id)).toEqual(['new-1']));

        // The slow earlier response arrives late — it must be discarded.
        await act(async () => {
            resolveOld({ problems: [makeRow('stale-1')], nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false, bulkEligibleCount: 1 });
            await oldQuery;
        });
        expect(result.current.problems.map(p => p.id)).toEqual(['new-1']);
    });

    it('a Show More failure keeps the loaded list and exposes a retry', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({ problems: [makeRow('p25')], nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false, bulkEligibleCount: 100 });

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            result.current.loadMore();
        });

        expect(result.current.loadMoreError).toBe(true);
        expect(result.current.problems).toHaveLength(25); // list untouched
        expect(result.current.hasMore).toBe(true); // cursor preserved for retry

        await act(async () => {
            result.current.loadMore(); // Retry
        });
        expect(result.current.loadMoreError).toBe(false);
        expect(result.current.problems).toHaveLength(26);
    });

    it('dedupes appended rows by problem id (defensive against cursor drift)', async () => {
        const duplicatedSecondPage = {
            problems: [makeRow('p25'), makeRow('p05'), makeRow('p26')],
            nextCursor: null,
            hasMore: false,
            authors: [],
            hasUnauthoredProblems: false,
        };
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(duplicatedSecondPage);

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            result.current.loadMore();
        });

        const ids = result.current.problems.map(p => p.id);
        expect(ids).toHaveLength(27); // 25 + p25 + p26 (p05 dropped)
        expect(new Set(ids).size).toBe(27);
    });

    it('a first-page failure surfaces the error without stale list content', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockRejectedValueOnce(new Error('fetch failed'));

        const { result } = renderHook(() => useAdminProblemsPage({}));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('Failed to fetch problems.');
        expect(result.current.problems).toEqual([]);
    });

    it('refresh() reloads the loaded span under the same query, keeping position', async () => {
        const secondPage = {
            problems: [makeRow('p25')],
            nextCursor: null,
            hasMore: false,
            authors: [],
            hasUnauthoredProblems: false,
        };
        // Refresh walks the span in pages of up to 100: 26 loaded rows in one call.
        const refreshedPage = {
            problems: [...firstPage.problems, secondPage.problems[0]],
            nextCursor: null,
            hasMore: false,
            authors: [{ name: 'admin' }],
            hasUnauthoredProblems: false,
        };
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(secondPage)
            .mockResolvedValueOnce(refreshedPage);

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => {
            result.current.loadMore();
        });
        expect(result.current.problems).toHaveLength(26);

        // Simulate a mutation (e.g. visibility toggle) triggering a refresh.
        await act(async () => {
            await result.current.refresh();
        });

        // The refresh asked for the whole loaded span (26 rows, capped at 100)
        // starting from the first page — no cursor.
        expect(adminService.getProblems).toHaveBeenLastCalledWith({ limit: 100 });
        expect(result.current.problems.map(p => p.id)).toEqual(refreshedPage.problems.map(p => p.id));
    });

    it('refresh() pages through multiple server pages when the span exceeds the max limit', async () => {
        const pageOf50 = (offset: number) => ({
            problems: Array.from({ length: 50 }, (_, i) => makeRow(`p${String(offset + i).padStart(2, '0')}`)),
        });
        // Load 75 rows: first batch 25 + two Show Mores of 25.
        const page1 = { ...firstPage, problems: pageOf50(0).problems.slice(0, 25), nextCursor: 'c1', hasMore: true };
        const page2 = { problems: pageOf50(25).problems, nextCursor: 'c2', hasMore: true, authors: [], hasUnauthoredProblems: false };
        const page3 = { problems: pageOf50(50).problems.slice(0, 25), nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false };
        const refreshPart1 = { problems: pageOf50(0).problems, nextCursor: 'rc1', hasMore: true, authors: [], hasUnauthoredProblems: false };
        const refreshPart2 = { problems: pageOf50(50).problems.slice(0, 25), nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false };
        (jest.mocked(adminService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(page1)
            .mockResolvedValueOnce(page2)
            .mockResolvedValueOnce(page3)
            .mockResolvedValueOnce(refreshPart1)   // refresh: first 50
            .mockResolvedValueOnce(refreshPart2);  // refresh: remaining 25

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { result.current.loadMore(); });
        await act(async () => { result.current.loadMore(); });
        expect(result.current.problems).toHaveLength(75);

        await act(async () => {
            await result.current.refresh();
        });

        const calls = (adminService.getProblems as jest.Mock).mock.calls;
        expect(calls[3]).toEqual([{ limit: 100 }]);                     // span start
        expect(calls[4]).toEqual([{ limit: 100, cursor: 'rc1' }]);      // span remainder
        expect(result.current.problems).toHaveLength(75);
    });

    it('refresh() preserves a Load All span longer than ten server pages', async () => {
        const rows = Array.from({ length: 1025 }, (_, i) => makeRow(`long-${i}`));
        const getProblems = jest.mocked(adminService.getProblems) as jest.Mock;
        getProblems.mockResolvedValueOnce({ ...firstPage, problems: rows.slice(0, 25), nextCursor: 'load-0' });
        for (let page = 0; page < 10; page += 1) {
            getProblems.mockResolvedValueOnce({
                ...firstPage,
                problems: rows.slice(25 + page * 100, 125 + page * 100),
                nextCursor: page === 9 ? null : `load-${page + 1}`,
                hasMore: page !== 9,
            });
        }
        for (let page = 0; page < 11; page += 1) {
            getProblems.mockResolvedValueOnce({
                ...firstPage,
                problems: rows.slice(page * 100, (page + 1) * 100),
                nextCursor: page === 10 ? null : `refresh-${page + 1}`,
                hasMore: page !== 10,
            });
        }

        const { result } = renderHook(() => useAdminProblemsPage({}));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { await result.current.loadAll(); });
        expect(result.current.problems).toHaveLength(1025);
        await act(async () => { await result.current.refresh(); });

        expect(result.current.problems).toHaveLength(1025);
        expect(getProblems).toHaveBeenCalledTimes(22);
        expect(getProblems.mock.calls[21][0]).toEqual({ limit: 100, cursor: 'refresh-10' });
    });
});
