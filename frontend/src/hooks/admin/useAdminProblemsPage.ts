import { useCallback, useEffect, useRef, useState } from 'react';
import adminService from '../../services/adminService';
import { ADMIN_PROBLEMS_PAGE } from '../../config/constants';
import type { AdminProblem, AdminProblemsPageResponse, AdminProblemsQuery } from '../../types';

/**
 * Server-side incremental ("Show More") loading for the admin problem
 * management list.
 *
 * The first page is fetched whenever `query` changes (search, collection,
 * visibility, author); "Show More" appends one page, while "Load All" walks
 * the remaining pages by following the server's opaque cursor. The DB
 * returns one batch per request. Filters run in SQL
 * BEFORE pagination, so a filter change resets rows + cursor and loads the
 * first batch of the new query (never appends across filter states).
 *
 * Unlike useIncrementalProblems, the page is refreshable in place: admin
 * actions (save/delete/visibility toggle/collection move) re-fetch the
 * CURRENT page span (first batch through the loaded cursor) so the table
 * keeps its position instead of collapsing back to 25 rows.
 *
 * Stale-response protection uses a monotonic request id: any new fetch
 * (page 1, Show More, Load All, or refresh) invalidates every in-flight response
 * with a lower id, so a slow earlier query can never overwrite a newer one.
 */
export const useAdminProblemsPage = (query: AdminProblemsQuery) => {
  const [problems, setProblems] = useState<AdminProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadAllError, setLoadAllError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  /** Distinct author filter options over the whole pool (server-provided). */
  const [authors, setAuthors] = useState<Array<{ name: string }>>([]);
  const [hasUnauthoredProblems, setHasUnauthoredProblems] = useState(false);
  const [bulkEligibleCount, setBulkEligibleCount] = useState(0);
  // Identifies the filter scope for which the count/page response is current.
  // Consumers with scope-wide actions must not use a stale count while a new
  // query is waiting to fetch (or has failed).
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  // Monotonic request id: two fetches started in the same millisecond must
  // not collide the way Date.now() did, or a stale response could win.
  const lastRequestIdRef = useRef(0);
  // Cursor for the NEXT page, kept in a ref so a rapid double-click cannot
  // fire two Show More requests against the same cursor.
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const loadingAllRef = useRef(false);
  const pageLoadingRef = useRef(true);
  const problemsRef = useRef<AdminProblem[]>([]);
  // Filter state the loaded rows belong to. A refresh must re-run the SAME
  // query (not whatever `query` is at call time) to avoid mixing batches.
  const loadedQueryRef = useRef<AdminProblemsQuery>(query);
  // How many rows are loaded under the current query — the refresh span.
  const loadedCountRef = useRef(0);

  const queryKey = JSON.stringify(query);

  const fetchFirstPage = useCallback((requestQuery: AdminProblemsQuery) => {
    const requestId = ++lastRequestIdRef.current;
    setLoading(true);
    pageLoadingRef.current = true;
    setError('');
    setLoadMoreError(false);
    setLoadAllError(false);
    loadingMoreRef.current = false;
    loadingAllRef.current = false;
    setLoadingMore(false);
    setLoadingAll(false);
    nextCursorRef.current = null;

    adminService.getProblems({ ...requestQuery, limit: ADMIN_PROBLEMS_PAGE.PAGE_SIZE })
      .then(page => {
        if (requestId !== lastRequestIdRef.current) return;
        setProblems(page.problems);
        problemsRef.current = page.problems;
        setHasMore(page.hasMore);
        setAuthors(page.authors);
        setHasUnauthoredProblems(page.hasUnauthoredProblems);
        setBulkEligibleCount(page.bulkEligibleCount);
        setLoadedQueryKey(JSON.stringify(requestQuery));
        nextCursorRef.current = page.nextCursor;
        loadedCountRef.current = page.problems.length;
      })
      .catch(() => {
        if (requestId !== lastRequestIdRef.current) return;
        setError('Failed to fetch problems.');
        setProblems([]);
        problemsRef.current = [];
        setHasMore(false);
        setAuthors([]);
        setHasUnauthoredProblems(false);
        setBulkEligibleCount(0);
        setLoadedQueryKey(null);
        nextCursorRef.current = null;
        loadedCountRef.current = 0;
      })
      .finally(() => {
        if (requestId === lastRequestIdRef.current) {
          pageLoadingRef.current = false;
          setLoading(false);
        }
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
    if (pageLoadingRef.current || loadingMoreRef.current || loadingAllRef.current || cursor === null
      || JSON.stringify(loadedQueryRef.current) !== queryKey) return;
    const requestId = ++lastRequestIdRef.current;
    const requestQuery = loadedQueryRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    setLoadAllError(false);

    adminService.getProblems({
      ...requestQuery,
      limit: ADMIN_PROBLEMS_PAGE.PAGE_SIZE,
      cursor,
    })
      .then(page => {
        if (requestId !== lastRequestIdRef.current) return;
        // Append, deduping by id (defensive against cursor drift).
        const seen = new Set(problemsRef.current.map(problem => problem.id));
        const fresh = page.problems.filter(problem => {
          if (seen.has(problem.id)) return false;
          seen.add(problem.id);
          return true;
        });
        const merged = [...problemsRef.current, ...fresh];
        problemsRef.current = merged;
        loadedCountRef.current = merged.length;
        setProblems(merged);
        setHasMore(page.hasMore);
        setAuthors(page.authors);
        setHasUnauthoredProblems(page.hasUnauthoredProblems);
        setBulkEligibleCount(page.bulkEligibleCount);
        setLoadedQueryKey(JSON.stringify(requestQuery));
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

  /** Walk the remaining pages for the current filter and loaded cursor. */
  const loadAll = useCallback(async () => {
    let cursor = nextCursorRef.current;
    if (pageLoadingRef.current || loadingMoreRef.current || loadingAllRef.current || cursor === null
      || JSON.stringify(loadedQueryRef.current) !== queryKey) return;

    const requestId = ++lastRequestIdRef.current;
    const requestQuery = loadedQueryRef.current;
    const visitedCursors = new Set<string>();
    loadingAllRef.current = true;
    setLoadingAll(true);
    setLoadAllError(false);
    setLoadMoreError(false);

    try {
      while (cursor && requestId === lastRequestIdRef.current) {
        if (visitedCursors.has(cursor)) throw new Error('Repeated problem cursor');
        visitedCursors.add(cursor);
        const page = await adminService.getProblems({ ...requestQuery, limit: 100, cursor });
        if (requestId !== lastRequestIdRef.current) return;

        const seen = new Set(problemsRef.current.map(problem => problem.id));
        const fresh = page.problems.filter(problem => {
          if (seen.has(problem.id)) return false;
          seen.add(problem.id);
          return true;
        });
        const merged = [...problemsRef.current, ...fresh];
        problemsRef.current = merged;
        loadedCountRef.current = merged.length;
        setProblems(merged);
        setHasMore(page.hasMore);
        setAuthors(page.authors);
        setHasUnauthoredProblems(page.hasUnauthoredProblems);
        setBulkEligibleCount(page.bulkEligibleCount);
        setLoadedQueryKey(JSON.stringify(requestQuery));

        if (!page.hasMore) {
          nextCursorRef.current = null;
          return;
        }
        if (!page.nextCursor || page.nextCursor === cursor) throw new Error('Invalid problem cursor');
        nextCursorRef.current = page.nextCursor;
        cursor = page.nextCursor;
      }
    } catch {
      if (requestId === lastRequestIdRef.current) setLoadAllError(true);
    } finally {
      if (requestId === lastRequestIdRef.current) {
        loadingAllRef.current = false;
        setLoadingAll(false);
      }
    }
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
    pageLoadingRef.current = true;
    loadingMoreRef.current = false;
    loadingAllRef.current = false;
    setLoadingMore(false);
    setLoadingAll(false);
    setLoadMoreError(false);
    setLoadAllError(false);
    setLoading(true);

    // The server caps each page at 100. Continue until the previous loaded
    // span is covered, so editing after Load All does not collapse a long list.
    const walk = async (): Promise<AdminProblemsPageResponse> => {
      let cursor: string | null = null;
      let collected: AdminProblem[] = [];
      const visitedCursors = new Set<string>();
      while (requestId === lastRequestIdRef.current) {
        if (cursor !== null) {
          if (visitedCursors.has(cursor)) throw new Error('Repeated problem cursor');
          visitedCursors.add(cursor);
        }
        const page = await adminService.getProblems({
          ...requestQuery,
          ...(cursor ? { cursor } : {}),
          limit: 100,
        });
        if (requestId !== lastRequestIdRef.current) return { ...page, problems: collected };
        const seen = new Set(collected.map(problem => problem.id));
        const fresh = page.problems.filter(problem => {
          if (seen.has(problem.id)) return false;
          seen.add(problem.id);
          return true;
        });
        collected = [...collected, ...fresh];
        if (!page.hasMore || collected.length >= loadedCountRef.current) {
          return { ...page, problems: collected };
        }
        if (!page.nextCursor || page.nextCursor === cursor) throw new Error('Invalid problem cursor');
        cursor = page.nextCursor;
      }
      throw new Error('Problem refresh superseded');
    };

    walk()
      .then(page => {
        if (requestId !== lastRequestIdRef.current) return;
        setProblems(page.problems);
        problemsRef.current = page.problems;
        setHasMore(page.hasMore);
        setAuthors(page.authors);
        setHasUnauthoredProblems(page.hasUnauthoredProblems);
        setBulkEligibleCount(page.bulkEligibleCount);
        nextCursorRef.current = page.nextCursor;
        loadedCountRef.current = page.problems.length;
      })
      .catch(() => {
        if (requestId !== lastRequestIdRef.current) return;
        setError('Failed to fetch problems.');
      })
      .finally(() => {
        if (requestId === lastRequestIdRef.current) {
          pageLoadingRef.current = false;
          setLoading(false);
        }
      });
  }, []);

  /** Reset cursor and loaded span after a filter-wide mutation. */
  const refreshFirstPage = useCallback(() => {
    loadedCountRef.current = 0;
    fetchFirstPage(loadedQueryRef.current);
  }, [fetchFirstPage]);

  return {
    problems,
    loading,
    error,
    loadingMore,
    loadMoreError,
    loadingAll,
    loadAllError,
    hasMore,
    authors,
    hasUnauthoredProblems,
    bulkEligibleCount,
    loadedQueryKey,
    loadMore,
    loadAll,
    refresh,
    refreshFirstPage,
  };
};

export default useAdminProblemsPage;
