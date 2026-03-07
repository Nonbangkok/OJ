import { useState, useEffect, useCallback } from 'react';
import contestService from '../services/contestService';

/**
 * Custom hook to manage contests data and actions
 */
export const useContests = () => {
    const [contests, setContests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchContests = useCallback(async () => {
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

    const joinContest = async (contestId) => {
        try {
            await contestService.join(contestId);
            setError('');
            await fetchContests(); // Refresh contests to update join status
            return { success: true };
        } catch (err) {
            console.error('Error joining contest:', err);
            const message = err.response?.data?.message || 'Failed to join contest';
            setError(message);
            return { success: false, message };
        }
    };

    return {
        contests,
        loading,
        error,
        setError,
        fetchContests,
        joinContest
    };
};
