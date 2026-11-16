import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import problemService from '../services/problemService';
import contestService from '../services/contestService';
import { getErrorStatus, toApiLikeError } from '../utils/error';
import type { Contest, ProblemDetail } from '../types';

/**
 * The problem page's data: the problem (with the viewer's best result,
 * attempt count and collection from the detail endpoint) and, on contest
 * routes, the contest.
 */
export const useProblemDetail = () => {
  const { contestId, problemId } = useParams();
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contest, setContest] = useState<Contest | null>(null);

  useEffect(() => {
    const fetchProblem = async () => {
      try {
        if (contestId && problemId) {
          const [problemData, contestRes] = await Promise.all([
            problemService.getContestProblemDetails(contestId, problemId),
            contestService.getById(contestId),
          ]);
          setProblem(problemData);
          setContest(contestRes);
        } else if (problemId) {
          setProblem(await problemService.getDetails(problemId));
        }
      } catch (err) {
        const apiError = toApiLikeError(err);
        // Hidden problems come back as 404 (same shape as nonexistent);
        // only staff ever see a hidden problem's detail.
        if (getErrorStatus(err) === 404) {
          setError(`Problem ${problemId} not found.`);
        } else {
          const responseMessage = apiError.response?.data?.message;
          setError(
            typeof responseMessage === 'string' && responseMessage
              ? responseMessage
              : `Failed to fetch problem ${problemId}.`
          );
        }
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (problemId) {
      fetchProblem();
    }
  }, [problemId, contestId]);

  return { problemId, contestId, problem, contest, loading, error };
};
