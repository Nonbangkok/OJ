import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import contestService from '../services/contestService';
import { POLLING_INTERVALS } from '../config/constants';
import type { Contest } from '../types';

interface UseContestGuardReturn {
    contest: Contest | null;
    isAccessible: boolean;
    loading: boolean;
    error: string;
    refetch: () => Promise<void>;
}

/**
 * Hook that manages contest access checks and auto-redirects.
 * Polls contest status every 15s and redirects if contest is finished.
 * @param {string | number} contestId - Contest ID from URL params
 * @returns {UseContestGuardReturn}
 */
export const useContestGuard = (contestId: string | number): UseContestGuardReturn => {
    const navigate = useNavigate();
    const [contest, setContest] = useState<Contest | null>(null);
    const [isAccessible, setIsAccessible] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');

    const checkAccess = useCallback(async (): Promise<void> => {
        try {
            const fetchedContest = await contestService.getById(contestId);
            setContest(fetchedContest);

            // Redirect if contest is finished
            if (fetchedContest.isActive === false && new Date(fetchedContest.endTime) < new Date()) {
                const redirectPath = fetchedContest.participants?.some(p => p.id === contestId) // Simplified check as types might vary
                    ? `/contests/${contestId}/scoreboard`
                    : '/contests';
                navigate(redirectPath);
                return;
            }

            setIsAccessible(true);
        } catch (err: any) {
            console.error('Error checking contest access:', err);
            if (err.response?.status === 403) {
                // Re-check if contest finished while user got 403
                try {
                    const statusCheck = await contestService.getById(contestId);
                    if (new Date(statusCheck.endTime) < new Date()) {
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
