import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import contestService from '../services/contestService';
import { POLLING_INTERVALS } from '../config/constants';

/**
 * Hook that manages contest access checks and auto-redirects.
 * Polls contest status every 15s and redirects if contest is finished.
 * @param {string} contestId - Contest ID from URL params
 * @returns {{ contest, isAccessible, loading, error }}
 */
export const useContestGuard = (contestId) => {
    const navigate = useNavigate();
    const [contest, setContest] = useState(null);
    const [isAccessible, setIsAccessible] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const checkAccess = useCallback(async () => {
        try {
            const fetchedContest = await contestService.getById(contestId);
            setContest(fetchedContest);

            // Redirect if contest is finished
            if (fetchedContest.status === 'finished') {
                const redirectPath = fetchedContest.is_participant
                    ? `/contests/${contestId}/scoreboard`
                    : '/contests';
                navigate(redirectPath);
                return;
            }

            setIsAccessible(true);
        } catch (err) {
            console.error('Error checking contest access:', err);
            if (err.response?.status === 403) {
                // Re-check if contest finished while user got 403
                try {
                    const statusCheck = await contestService.getById(contestId);
                    if (statusCheck.status === 'finished') {
                        navigate('/contests');
                        return;
                    }
                } catch (innerErr) {
                    console.error('Failed to re-check contest status:', innerErr);
                }
                setError('You may not have access to this contest.');
            } else if (err.response?.status === 404) {
                setError('Contest not found.');
            } else {
                setError('Failed to load contest data.');
            }
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
