import { useCallback, useEffect, useState } from 'react';
import contestService from '../services/contestService';
import { POLLING_INTERVALS } from '../config/constants';
import type {
  Contest,
  ContestProblem,
  ContestProblemScore,
  ContestScoreboardEntry,
} from '../types';
import { getErrorStatus } from '../utils/error';

type ScoreValue = ContestProblemScore | null;

interface UseContestScoreboardResult {
  contest: Contest | null;
  scoreboard: ContestScoreboardEntry[];
  problems: ContestProblem[];
  loading: boolean;
  error: string;
  lastUpdate: Date | null;
  formatDateTime: (dateTime: Date | string) => string;
  getProblemScore: (userScores: Record<string, unknown> | null | undefined, problemId: string) => ScoreValue;
}

const useContestScoreboard = (contestId?: string | number): UseContestScoreboardResult => {
  const [contest, setContest] = useState<Contest | null>(null);
  const [scoreboard, setScoreboard] = useState<ContestScoreboardEntry[]>([]);
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchContestData = useCallback(async () => {
    if (!contestId) {
      setError('Contest not found.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [contestData, scoreboardData] = await Promise.all([
        contestService.getById(contestId),
        contestService.getScoreboard(contestId),
      ]);

      setContest(contestData);
      setScoreboard(scoreboardData.scoreboard);
      setProblems(scoreboardData.problems || []);
      setLastUpdate(new Date());
    } catch (errorValue) {
      console.error('Error fetching contest data:', errorValue);
      const status = getErrorStatus(errorValue);
      if (status === 404) {
        setError('Contest not found.');
      } else if (status === 403) {
        setError('You do not have permission to view this contest scoreboard');
      } else {
        setError('Failed to load contest scoreboard.');
      }
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  const fetchScoreboard = useCallback(async () => {
    if (!contestId) {
      return;
    }

    try {
      const data = await contestService.getScoreboard(contestId);

      setScoreboard(data.scoreboard);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error refreshing scoreboard:', err);
    }
  }, [contestId]);

  useEffect(() => {
    void fetchContestData();
  }, [fetchContestData]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (contest?.status === 'running') {
      interval = setInterval(() => {
        void fetchScoreboard();
      }, POLLING_INTERVALS.SCOREBOARD);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [contest?.status, fetchScoreboard]);

  const formatDateTime = (dateTime: Date | string) => {
    return new Date(dateTime).toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getProblemScore = (
    userScores: Record<string, unknown> | null | undefined,
    problemId: string,
  ): ScoreValue => {
    if (!userScores || typeof userScores !== 'object') return null;

    const problemScore = userScores[problemId] as unknown;
    if (!problemScore) return null;

    if (typeof problemScore === 'number') {
      return {
        score: problemScore,
        attempts: 1,
        solved: problemScore === 100,
      };
    }

    if (typeof problemScore === 'object') {
      const normalizedScore = problemScore as Partial<ContestProblemScore>;
      return {
        score: normalizedScore.score ?? 0,
        attempts: normalizedScore.attempts ?? 1,
        solved: (normalizedScore.score ?? 0) === 100,
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
    getProblemScore,
  };
};

export default useContestScoreboard;
