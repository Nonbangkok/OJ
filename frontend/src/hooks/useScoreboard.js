import { useState, useEffect, useCallback } from 'react';
import scoreboardService from '../services/scoreboardService';

/**
 * Custom hook to manage scoreboard data
 */
export const useScoreboard = (contestId = null) => {
    const [scoreboard, setScoreboard] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchScoreboard = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            let data;
            if (contestId) {
                // Assume contestService or scoreboardService has a method for this
                // For now, let's stick to global or adjust if needed
                data = await scoreboardService.getGlobal();
            } else {
                data = await scoreboardService.getGlobal();
            }
            setScoreboard(data);
        } catch (err) {
            console.error('Error fetching scoreboard:', err);
            setError('Failed to fetch scoreboard. Please log in.');
        } finally {
            setLoading(false);
        }
    }, [contestId]);

    useEffect(() => {
        fetchScoreboard();
    }, [fetchScoreboard]);

    return {
        scoreboard,
        loading,
        error,
        fetchScoreboard
    };
};
