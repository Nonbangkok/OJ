import { useState, useEffect } from 'react';
import contestService from '../services/contestService';
import { POLLING_INTERVALS } from '../config/constants';
import type { Contest, ContestScoreboardResponse, ContestScoreboardEntry, ContestScoreboardProblem } from '../types';

interface UserScoreDetail {
    score: number;
    attempts: number;
    solved: boolean;
}

interface UseContestScoreboardReturn {
    contest: Contest | null;
    scoreboard: ContestScoreboardEntry[];
    problems: ContestScoreboardProblem[];
    loading: boolean;
    error: string;
    lastUpdate: Date | null;
    formatDateTime: (dateTime: string) => string;
    getProblemScore: (userScores: Record<string | number, { score: number }>, problemId: string | number) => UserScoreDetail | null;
}

const useContestScoreboard = (contestId: string | number): UseContestScoreboardReturn => {
    const [contest, setContest] = useState<Contest | null>(null);
    const [scoreboard, setScoreboard] = useState<ContestScoreboardEntry[]>([]);
    const [problems, setProblems] = useState<ContestScoreboardProblem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    useEffect(() => {
        fetchContestData();
    }, [contestId]);

    useEffect(() => {
        // Auto-refresh for running contests
        let interval: NodeJS.Timeout;
        if (contest?.isActive) {
            interval = setInterval(fetchScoreboard, POLLING_INTERVALS.SCOREBOARD); // Refresh every 30 seconds
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [contest?.isActive]);

    const fetchContestData = async (): Promise<void> => {
        try {
            setLoading(true);

            // Fetch contest details and scoreboard in parallel
            const [contestData, scoreboardData] = await Promise.all([
                contestService.getById(contestId),
                contestService.getScoreboard(contestId)
            ]);

            setContest(contestData);
            // Handle the response structure from contest scoreboard API
            const data = scoreboardData as unknown as ContestScoreboardResponse;
            if (data.scoreboard) {
                setScoreboard(data.scoreboard);
                setProblems(data.problems || []);
            } else {
                setScoreboard(scoreboardData as unknown as ContestScoreboardEntry[]);
            }
            
            setLastUpdate(new Date());

        } catch (err: any) {
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

    const fetchScoreboard = async (): Promise<void> => {
        try {
            const data = await contestService.getScoreboard(contestId) as any;

            // The response will always have scoreboard and problems, but we only need to update the scoreboard on refresh.
            if (data.scoreboard) {
                setScoreboard(data.scoreboard);
            } else {
                setScoreboard(data as ContestScoreboardEntry[]);
            }
            setLastUpdate(new Date());
        } catch (err) {
            console.error('Error refreshing scoreboard:', err);
        }
    };

    const formatDateTime = (dateTime: string): string => {
        return new Date(dateTime).toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const getProblemScore = (userScores: any, problemId: string | number): UserScoreDetail | null => {
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
