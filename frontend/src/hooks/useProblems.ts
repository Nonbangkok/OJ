import { useCallback, useEffect, useState } from 'react';
import problemService from '../services/problemService';
import contestService from '../services/contestService';
import type { ProblemBase, ProblemDetail } from '../types';

/**
 * Fetches problem list with stats. If contestId is provided,
 * fetches contest-specific problems instead.
 * @param {string} [contestId] - Optional contest ID for contest problems
 */
type ProblemsList = ProblemBase[] | ProblemDetail[];

interface UseProblemsResult {
  problems: ProblemsList;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

export const useProblems = (contestId: string | null = null): UseProblemsResult => {
  const [problems, setProblems] = useState<ProblemsList>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProblems = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = contestId
        ? await contestService.getProblems(contestId)
        : await problemService.getAllWithStats();
      setProblems(data);
    } catch (err) {
      setError(
        contestId ? 'Failed to fetch contest problems.' : 'Failed to fetch problems. Please log in.'
      );
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => {
    void fetchProblems();
  }, [fetchProblems]);

  return { problems, loading, error, refresh: fetchProblems };
};
