import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import problemService from '../services/problemService';
import contestService from '../services/contestService';
import { getErrorStatus, toApiLikeError } from '../utils/error';
import type { Contest, ProblemDetail } from '../types';

/** What one problem's fetch produced, tagged with the route it was for. */
interface Loaded {
  key: string;
  problem: ProblemDetail | null;
  contest: Contest | null;
  error: string;
}

const routeKey = (contestId: string | undefined, problemId: string | undefined): string =>
  JSON.stringify([contestId ?? null, problemId ?? null]);

const errorMessage = (err: unknown, problemId: string): string => {
  // Hidden problems come back as 404 (same shape as nonexistent);
  // only staff ever see a hidden problem's detail.
  if (getErrorStatus(err) === 404) return `Problem ${problemId} not found.`;
  const responseMessage = toApiLikeError(err).response?.data?.message;
  return typeof responseMessage === 'string' && responseMessage
    ? responseMessage
    : `Failed to fetch problem ${problemId}.`;
};

/**
 * The problem page's data: the problem (with the viewer's best result,
 * attempt count and collection from the detail endpoint) and, on contest
 * routes, the contest.
 *
 * A7-04: the router keeps the page mounted when only :problemId (or
 * :contestId) changes, so every result is tagged with the route it was
 * fetched for and only the current route's result is returned. Moving to
 * another problem therefore shows loading, never the previous problem's
 * fields or error, and a late answer for a problem already left is dropped.
 */
export const useProblemDetail = () => {
  const { contestId, problemId } = useParams();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!problemId) return undefined;
    let cancelled = false;
    const key = routeKey(contestId, problemId);

    const fetchProblem = async (): Promise<Loaded> => {
      try {
        if (contestId) {
          const [problemData, contestRes] = await Promise.all([
            problemService.getContestProblemDetails(contestId, problemId),
            contestService.getById(contestId),
          ]);
          return { key, problem: problemData, contest: contestRes, error: '' };
        }
        return { key, problem: await problemService.getDetails(problemId), contest: null, error: '' };
      } catch (err) {
        console.error(err);
        return { key, problem: null, contest: null, error: errorMessage(err, problemId) };
      }
    };

    void fetchProblem().then((result) => {
      if (!cancelled) setLoaded(result);
    });
    return () => { cancelled = true; };
  }, [problemId, contestId]);

  const current = loaded?.key === routeKey(contestId, problemId) ? loaded : null;
  return {
    problemId,
    contestId,
    problem: current?.problem ?? null,
    contest: current?.contest ?? null,
    loading: current === null,
    error: current?.error ?? '',
  };
};
