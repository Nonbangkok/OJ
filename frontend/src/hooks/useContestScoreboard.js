import { useState, useEffect } from 'react';
import contestService from '../services/contestService';
import { POLLING_INTERVALS } from '../config/constants';

const useContestScoreboard = (contestId) => {
    const [contest, setContest] = useState(null);
    const [scoreboard, setScoreboard] = useState([]);
    const [problems, setProblems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdate, setLastUpdate] = useState(null);

    useEffect(() => {
        fetchContestData();
    }, [contestId]);

    useEffect(() => {
        // Auto-refresh for running contests
        let interval;
        if (contest?.status === 'running') {
            interval = setInterval(fetchScoreboard, POLLING_INTERVALS.SCOREBOARD); // Refresh every 30 seconds
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [contest?.status]);

    const fetchContestData = async () => {
        try {
            setLoading(true);

            // Fetch contest details and scoreboard in parallel
            const [contestData, scoreboardData] = await Promise.all([
                contestService.getById(contestId),
                contestService.getScoreboard(contestId)
            ]);

            setContest(contestData);
            setScoreboard(scoreboardData.scoreboard);
            setProblems(scoreboardData.problems || []);
            setLastUpdate(new Date());

        } catch (err) {
            console.error('Error fetching contest data:', err);
            if (err.response?.status === 404) {
                setError('Contest not found.');
            } else if (err.response?.status === 403) {
                setError('You do not have permission to view this contest scoreboard');
            } else {
                setError('Failed to load contest scoreboard.');
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchScoreboard = async () => {
        try {
            const data = await contestService.getScoreboard(contestId);

            // The response will always have scoreboard and problems, but we only need to update the scoreboard on refresh.
            setScoreboard(data.scoreboard);
            setLastUpdate(new Date());
        } catch (err) {
            console.error('Error refreshing scoreboard:', err);
        }
    };

    const formatDateTime = (dateTime) => {
        return new Date(dateTime).toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const getProblemScore = (userScores, problemId) => {
        if (!userScores || typeof userScores !== 'object') return null;

        const problemScore = userScores[problemId];
        if (!problemScore) return null;

        // Handle both old format (just number) and new format (object)
        if (typeof problemScore === 'number') {
            return {
                score: problemScore,
                attempts: 1, // Default to 1 for old format
                solved: problemScore === 100
            };
        }

        if (typeof problemScore === 'object') {
            return {
                score: problemScore.score || 0,
                attempts: problemScore.attempts || 1,
                solved: (problemScore.score || 0) === 100
            };
        }

        return null;
    };

    return {
        contest,
        scoreboard,
        problems,
        loading,
        error,
        lastUpdate,
        formatDateTime,
        getProblemScore
    };
};

export default useContestScoreboard;
