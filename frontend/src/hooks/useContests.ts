import { useState, useEffect, useCallback } from 'react';
import contestService from '../services/contestService';
import type { Contest } from '../types';

interface UseContestsReturn {
  contests: Contest[];
  loading: boolean;
  error: string;
  fetchContests: () => Promise<void>;
  joinContest: (contestId: string | number) => Promise<{ success: boolean; message?: string }>;
  refreshContests: () => void;
}

/**
 * Custom hook to manage contests data and actions
 */
export const useContests = (): UseContestsReturn => {
    const [contests, setContests] = useState<Contest[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');

    const fetchContests = useCallback(async (): Promise<void> => {
        try {
            setLoading(true);
            const data = await contestService.getAll();
            setContests(data);
        } catch (err) {
            console.error('Error fetching contests:', err);
            setError('Failed to load contests');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchContests();
    }, [fetchContests]);

    const joinContest = async (contestId: string | number): Promise<{ success: boolean; message?: string }> => {
        try {
            await contestService.join(contestId);
            setError('');
            await fetchContests(); // Refresh contests to update join status
            return { success: true };
        } catch (err: any) {
            console.error('Error joining contest:', err);
            const message = err.response?.data?.message || 'Failed to join contest';
            setError(message);
            return { success: false, message };
        }
    };

    const refreshContests = (): void => {
        fetchContests();
    };

    return {
        contests,
        loading,
        error,
        fetchContests,
        joinContest,
        refreshContests
    };
};
