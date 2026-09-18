import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import contestService from '../services/contestService';
import { POLLING_INTERVALS } from '../config/constants';
import { fetchContestOutcome, finishedContestRedirectPath } from './contestStatusFetch';
import type { Contest } from '../types';

interface UseContestGuardResult {
  contest: Contest | null;
  isAccessible: boolean;
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
}

/**
 * Hook that manages contest access checks and auto-redirects.
 * Polls contest status every 15s and redirects if contest is finished.
 * @param {string} contestId - Contest ID from URL params
 * @returns {{ contest, isAccessible, loading, error }}
 */
export const useContestGuard = (
  contestId: string | undefined
): UseContestGuardResult => {
  const navigate = useNavigate();
  const [contest, setContest] = useState<Contest | null>(null);
  const [isAccessible, setIsAccessible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const checkAccess = useCallback(async () => {
    if (!contestId) return;
    try {
      const outcome = await fetchContestOutcome(contestId);
      if (outcome.kind === 'finished') {
        setContest(outcome.contest);
        navigate(outcome.redirectPath);
        return;
      }
      if (outcome.kind === 'loaded') {
        setContest(outcome.contest);
        setIsAccessible(true);
        return;
      }
      if (outcome.kind === 'forbidden') {
        // Re-check if contest finished while user got 403
        try {
          const statusCheck = await contestService.getById(contestId);
          if (statusCheck.status === 'finished') {
            navigate(finishedContestRedirectPath(contestId, Boolean(statusCheck.is_participant)));
            return;
          }
        } catch (innerErr) {
          console.error('Failed to re-check contest status:', innerErr);
        }
        setError('You may not have access to this contest.');
        return;
      }
      if (outcome.kind === 'not-found') {
        setError('Contest not found.');
        return;
      }
      setError('Failed to load contest data.');
    } finally {
      setLoading(false);
    }
  }, [contestId, navigate]);

  useEffect(() => {
    checkAccess();
    const intervalId = setInterval(checkAccess, POLLING_INTERVALS.CONTEST_GUARD);
    return () => clearInterval(intervalId);
  }, [checkAccess]);

  return { contest, isAccessible, loading, error, refetch: checkAccess };
};
