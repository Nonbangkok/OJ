import { useState, useEffect } from 'react';
import problemService from '../services/problemService';
import contestService from '../services/contestService';
import type { Problem, ProblemWithStats } from '../types';

interface UseProblemsReturn {
  problems: (Problem | ProblemWithStats)[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

/**
 * Fetches problem list with stats. If contestId is provided,
 * fetches contest-specific problems instead.
 * @param {string | number} [contestId] - Optional contest ID for contest problems
 */
export const useProblems = (contestId?: string | number): UseProblemsReturn => {
  const [problems, setProblems] = useState<(Problem | ProblemWithStats)[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchProblems = async (): Promise<void> => {
    try {
      setLoading(true);
      setError('');
      const data = contestId
        ? await contestService.getProblems(contestId)
        : await problemService.getAllWithStats();
      setProblems(data as (Problem | ProblemWithStats)[]);
    } catch (err) {
      setError(contestId
        ? 'Failed to fetch contest problems.'
        : 'Failed to fetch problems. Please log in.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProblems();
  }, [contestId]);

  return { problems, loading, error, refresh: fetchProblems };
};