import { useCallback, useEffect, useRef, useState } from 'react';
import adminService from '../../services/adminService';
import { ADMIN_PROBLEMS_PAGE } from '../../config/constants';
import type { AdminProblem, AdminProblemsPageResponse, AdminProblemsQuery } from '../../types';

/**
 * Server-side incremental ("Show More") loading for the admin problem
 * management list.
 *
 * The first page is fetched whenever `query` changes (search, collection,
 * visibility, author); "Show More" appends subsequent pages by following
 * the server's opaque cursor. The DB always returns just one batch — the
 * full list is never fetched and sliced client-side. Filters run in SQL
 * BEFORE pagination, so a filter change resets rows + cursor and loads the
 * first batch of the new query (never appends across filter states).
 *
 * Unlike useIncrementalProblems, the page is refreshable in place: admin
 * actions (save/delete/visibility toggle/collection move) re-fetch the
 * CURRENT page span (first batch through the loaded cursor) so the table
 * keeps its position instead of collapsing back to 25 rows.
 *
 * Stale-response protection uses a monotonic request id: any new fetch
 * (page 1, Show More, or refresh) invalidates every in-flight response
 * with a lower id, so a slow earlier query can never overwrite a newer one.
 */
export const useAdminProblemsPage = (query: AdminProblemsQuery) => {
  const [problems, setProblems] = useState<AdminProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  /** Distinct author filter options over the whole pool (server-provided). */
  const [authors, setAuthors] = useState<Array<{ name: string }>>([]);
  const [hasUnauthoredProblems, setHasUnauthoredProblems] = useState(false);
  // Monotonic request id: two fetches started in the same millisecond must
  // not collide the way Date.now() did, or a stale response could win.
  const lastRequestIdRef = useRef(0);
  // Cursor for the NEXT page, kept in a ref so a rapid double-click cannot
  // fire two Show More requests against the same cursor.
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  // Filter state the loaded rows belong to. A refresh must re-run the SAME
  // query (not whatever `query` is at call time) to avoid mixing batches.
  const loadedQueryRef = useRef<AdminProblemsQuery>(query);
  // How many rows are loaded under the current query — the refresh span.
  const loadedCountRef = useRef(0);

  const queryKey = JSON.stringify(query);

  const fetchFirstPage = useCallback((requestQuery: AdminProblemsQuery) => {
    const requestId = ++lastRequestIdRef.current;
    setLoading(true);
    setError('');
    setLoadMoreError(false);
    loadingMoreRef.current = false;
    nextCursorRef.current = null;

    adminService.getProblems({ ...requestQuery, limit: ADMIN_PROBLEMS_PAGE.PAGE_SIZE })
      .then(page => {
        if (requestId !== lastRequestIdRef.current) return;
        setProblems(page.problems);
        setHasMore(page.hasMore);
        setAuthors(page.authors);
        setHasUnauthoredProblems(page.hasUnauthoredProblems);
        nextCursorRef.current = page.nextCursor;
        loadedCountRef.current = page.problems.length;
      })
      .catch(() => {
        if (requestId !== lastRequestIdRef.current) return;
        setError('Failed to fetch problems.');
        setProblems([]);
        setHasMore(false);
        setAuthors([]);
        setHasUnauthoredProblems(false);
        nextCursorRef.current = null;
        loadedCountRef.current = 0;
      })
      .finally(() => {
        if (requestId === lastRequestIdRef.current) setLoading(false);
      });
  }, []);

  // First page: resets the list whenever the query changes. Never appends
  // across different queries.
  useEffect(() => {
    loadedQueryRef.current = query;
    fetchFirstPage(query);
    // The serialized query is the dependency — a new object identity with
    // equal contents must not restart the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current;
    // Guard against double-clicks and re-entrancy: a batch already in
    // flight, or no next page, is a no-op.
    if (loadingMoreRef.current || cursor === null) return;
    const requestId = ++lastRequestIdRef.current;
    const requestQuery = loadedQueryRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    adminService.getProblems({
      ...requestQuery,
      limit: ADMIN_PROBLEMS_PAGE.PAGE_SIZE,
      cursor,
    })
      .then(page => {
        if (requestId !== lastRequestIdRef.current) return;
        // Append, deduping by id (defensive against cursor drift).
        setProblems(previous => {
          const seen = new Set(previous.map(problem => problem.id));
          const fresh = page.problems.filter(problem => !seen.has(problem.id));
          loadedCountRef.current = previous.length + fresh.length;
          return [...previous, ...fresh];
        });
        setHasMore(page.hasMore);
        setAuthors(page.authors);
        setHasUnauthoredProblems(page.hasUnauthoredProblems);
        nextCursorRef.current = page.nextCursor;
      })
      .catch(() => {
        if (requestId !== lastRequestIdRef.current) return;
        // The loaded list stays exactly as it was; the button becomes a Retry.
        setLoadMoreError(true);
      })
      .finally(() => {
        if (requestId === lastRequestIdRef.current) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
    // The serialized query participates in the closure: a query change
    // while a Show More is in flight invalidates its response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  /**
   * Re-fetch the CURRENT page span (every batch loaded so far, in one
   * request) under the same filters. Used after admin mutations so the
   * table keeps its position instead of resetting to the first batch.
   * Keyset ordering by unique id makes the first `loadedCount` rows of a
   * fresh walk the same rows that were loaded before (modulo concurrent
   * inserts/deletes shifting the tail).
   */
  const refresh = useCallback(() => {
    const requestQuery = loadedQueryRef.current;
    const requestId = ++lastRequestIdRef.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoading(true);

    // The server page is bounded by MAX_LIMIT (100); page through with full
    // pages until the loaded span is covered or the list ends. Bounded hard
    // (a server that never stops paging cannot loop forever).
    const walk = async (cursor: string | null, collected: AdminProblem[], pagesLeft: number): Promise<AdminProblemsPageResponse> => {
      const page = await adminService.getProblems({
        ...requestQuery,
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      // Dedupe by id defensively (keyset on a unique key cannot repeat,
      // but a concurrent rename could in principle re-order rows).
      const seen = new Set(collected.map(problem => problem.id));
      const merged = [...collected, ...page.problems.filter(problem => !seen.has(problem.id))];
      if (!page.hasMore || merged.length >= loadedCountRef.current || pagesLeft <= 1) {
        return { ...page, problems: merged };
      }
      return walk(page.nextCursor, merged, pagesLeft - 1);
    };

    walk(null, [], 10)
      .then(page => {
        if (requestId !== lastRequestIdRef.current) return;
        setProblems(page.problems);
        setHasMore(page.hasMore);
        setAuthors(page.authors);
        setHasUnauthoredProblems(page.hasUnauthoredProblems);
        nextCursorRef.current = page.nextCursor;
        loadedCountRef.current = page.problems.length;
      })
      .catch(() => {
        if (requestId !== lastRequestIdRef.current) return;
        setError('Failed to fetch problems.');
      })
      .finally(() => {
        if (requestId === lastRequestIdRef.current) setLoading(false);
      });
  }, []);

  return {
    problems,
    loading,
    error,
    loadingMore,
    loadMoreError,
    hasMore,
    authors,
    hasUnauthoredProblems,
    loadMore,
    refresh,
  };
};

export default useAdminProblemsPage;
