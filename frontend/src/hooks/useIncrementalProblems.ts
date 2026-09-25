import { useCallback, useEffect, useRef, useState } from 'react';
import problemService, { type ProblemListQuery } from '../services/problemService';
import { PROBLEMS_PAGE } from '../config/constants';
import type { ProblemSummary } from '../types';

/**
 * Incremental ("Show More") loading for the standalone problems list.
 *
 * The first page is fetched whenever `query` changes (search, category,
 * difficulty, sort); "Show More" appends subsequent pages by following the
 * server's opaque cursor. The DB always returns just one batch — no full
 * list is ever fetched.
 *
 * Stale-response protection uses the same monotonic request id as
 * useSubmissions: any new fetch (page 1 or a Show More) invalidates every
 * in-flight response with a lower id, so a slow earlier query can never
 * overwrite a newer one.
 */
export const useIncrementalProblems = (query: ProblemListQuery) => {
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Monotonic request id: two fetches started in the same millisecond must
  // not collide the way Date.now() did, or a stale response could win.
  const lastRequestIdRef = useRef(0);
  // Cursor for the NEXT page, kept in a ref so a rapid double-click cannot
  // fire two Show More requests against the same cursor.
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  const queryKey = JSON.stringify(query);

  // First page: resets the list whenever the query changes. Never appends
  // across different queries.
  useEffect(() => {
    const requestId = ++lastRequestIdRef.current;
    let cancelled = false;
    const isCurrent = () => !cancelled && requestId === lastRequestIdRef.current;

    setLoading(true);
    setError('');
    setLoadMoreError(false);
    loadingMoreRef.current = false;
    nextCursorRef.current = null;

    problemService.getProblemsPage({ ...query, limit: PROBLEMS_PAGE.PAGE_SIZE })
      .then(page => {
        if (!isCurrent()) return;
        setProblems(page.problems);
        setHasMore(page.hasMore);
        nextCursorRef.current = page.nextCursor;
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (!isCurrent()) return;
        setError('Failed to fetch problems.');
        setProblems([]);
        setHasMore(false);
        nextCursorRef.current = null;
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    problemService.getProblemsPage({
      ...query,
      limit: PROBLEMS_PAGE.PAGE_SIZE,
      cursor,
    })
      .then(page => {
        if (requestId !== lastRequestIdRef.current) return;
        // Append, deduping by id (defensive against cursor drift).
        setProblems(previous => {
          const seen = new Set(previous.map(problem => problem.id));
          return [...previous, ...page.problems.filter(problem => !seen.has(problem.id))];
        });
        setHasMore(page.hasMore);
        nextCursorRef.current = page.nextCursor;
        setNextCursor(page.nextCursor);
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

  return {
    problems,
    loading,
    error,
    loadingMore,
    loadMoreError,
    hasMore,
    nextCursor,
    loadMore,
  };
};
