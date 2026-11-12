import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import contestService from '../services/contestService';
import { POLLING_INTERVALS } from '../config/constants';
import { fetchContestOutcome } from './contestStatusFetch';
import { useAuth } from '../context/AuthContext';

/**
 * Custom hook to handle logic for ContestDetail page.
 * Separates data fetching, polling, joining, and navigation logic.
 */
const useContestDetail = () => {
  const { contestId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [contest, setContest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  // Last fetched status, for the forbidden-after-finish re-check. Kept in a ref
  // so a status change does not recreate fetchContestData and restart the
  // polling effect (which re-fetched with the full-page loading state).
  const lastStatus = useRef<string | undefined>(undefined);

  const fetchContestData = useCallback(
    async (isInitial = false) => {
      try {
        if (isInitial) setLoading(true);

        const outcome = await fetchContestOutcome(contestId as string, {
          previousStatus: lastStatus.current,
        });

        if (outcome.kind === 'finished' || outcome.kind === 'loaded' || outcome.kind === 'forbidden') {
          if (outcome.contest !== null) {
            lastStatus.current = outcome.contest.status;
            setContest(outcome.contest);
          }
        }

        if (outcome.kind === 'finished') {
          navigate(outcome.redirectPath);
        } else if (outcome.kind === 'forbidden') {
          setError('You need to join this contest to view its details.');
          if (outcome.redirectPath) {
            navigate(outcome.redirectPath);
          }
        } else if (outcome.kind === 'not-found') {
          setError('Contest not found.');
        } else if (outcome.kind === 'error') {
          setError('Failed to load contest data.');
        }
      } catch (err) {
        console.error('Error fetching contest data:', err);
        setError('Failed to load contest data.');
      } finally {
        if (isInitial) setLoading(false);
      }
    },
    [contestId, navigate]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- contestId-keyed initial fetch + poll; the initial fetch flips the full-page loading state
    fetchContestData(true);

    const intervalId = setInterval(() => {
      fetchContestData();
    }, POLLING_INTERVALS.CONTEST_GUARD);

    return () => clearInterval(intervalId);
  }, [fetchContestData]);

  const handleJoinContest = async () => {
    setJoining(true);
    try {
      await contestService.join(contestId);
      await fetchContestData();
    } catch (err) {
      console.error('Error joining contest:', err);
      alert(err.response?.data?.message || 'Failed to join contest');
    } finally {
      setJoining(false);
    }
  };

  return {
    contest,
    loading,
    error,
    joining,
    handleJoinContest,
    fetchContestData,
  };
};

export default useContestDetail;
