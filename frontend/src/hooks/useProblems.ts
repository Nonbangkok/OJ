import { useCallback, useEffect, useState } from 'react';
import problemService from '../services/problemService';
import contestService from '../services/contestService';
import type { ProblemBase, ProblemSummary } from '../types';

/**
 * Fetches problem list with stats. If contestId is provided,
 * fetches contest-specific problems instead.
 * @param {string} [contestId] - Optional contest ID for contest problems
 * @param {boolean} [enabled] - Whether to fetch (used to wait on a guard)
 */

interface UseProblemsResult {
  problems: ProblemSummary[] | ProblemBase[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

export const useProblems = (contestId: string | null = null, enabled = true): UseProblemsResult => {
  const [problems, setProblems] = useState<ProblemSummary[] | ProblemBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProblems = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setError('');
      return;
    }

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
  }, [contestId, enabled]);

  useEffect(() => {
    void fetchProblems();
  }, [fetchProblems]);

  return { problems, loading, error, refresh: fetchProblems };
};
