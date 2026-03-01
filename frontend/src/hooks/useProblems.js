import { useState, useEffect } from 'react';
import problemService from '../services/problemService';
import contestService from '../services/contestService';

/**
 * Fetches problem list with stats. If contestId is provided,
 * fetches contest-specific problems instead.
 * @param {string} [contestId] - Optional contest ID for contest problems
 */
export const useProblems = (contestId) => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProblems = async () => {
    try {
      setLoading(true);
      const data = contestId
        ? await contestService.getProblems(contestId)
        : await problemService.getAllWithStats();
      setProblems(data);
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