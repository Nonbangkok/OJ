import { useCallback, useEffect, useState } from 'react';
import contestService from '../services/contestService';
import { subscribeScoreboard, isRealtimeSupported } from '../services/realtimeService';
import { POLLING_INTERVALS, REALTIME } from '../config/constants';
import type {
  Contest,
  ContestProblem,
  ContestProblemScore,
  ContestScoreboardEntry,
  ContestStatus,
} from '../types';
import { getErrorStatus } from '../utils/error';
import { useAuth } from '../context/AuthContext';

/** One scoreboard cell in the B9 shape; old snapshots stored a bare number or { score }. */
export const scoreCell = (raw: unknown): ContestProblemScore | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return { score: raw };
  if (typeof raw === 'object') {
    const cell = raw as Partial<ContestProblemScore>;
    return { ...cell, score: cell.score ?? 0 };
  }
  return null;
};

interface UseContestScoreboardResult {
  contest: Contest | null;
  scoreboard: ContestScoreboardEntry[];
  problems: ContestProblem[];
  loading: boolean;
  error: string;
  lastUpdate: Date | null;
  /** True while the realtime stream is up (signed-in viewers only). */
  connected: boolean;
  /** Contest state and start, as carried by the scoreboard payload (B9). */
  status: ContestStatus | null;
  startTime: string | null;
}

const useContestScoreboard = (contestId?: string | number): UseContestScoreboardResult => {
  // Guests (PUBLIC mode) never subscribe to the realtime stream: the SSE
  // endpoint requires a session, and its 401 would be pure console noise.
  // The polling fallback covers them.
  const { user } = useAuth();
  const [contest, setContest] = useState<Contest | null>(null);
  const [scoreboard, setScoreboard] = useState<ContestScoreboardEntry[]>([]);
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [status, setStatus] = useState<ContestStatus | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  // Realtime (SSE) state — see useSubmissions for the pattern: while the
  // stream is healthy the interval poll is a slow safety net; a dead stream
  // (readyState CLOSED, not a transient retry) reverts to fast polling.
  const [realtimeDown, setRealtimeDown] = useState(!isRealtimeSupported());

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
      setStatus(scoreboardData.status ?? null);
      setStartTime(scoreboardData.start_time ?? null);
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
      setStatus(data.status ?? null);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error refreshing scoreboard:', err);
    }
  }, [contestId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- contestId-keyed fetch that flips loading before its request starts
    void fetchContestData();
  }, [fetchContestData]);

  // Realtime scoreboard pings — refetch on every "something changed" event
  // for this contest (verdict landed, post-contest migration rewrote the
  // final scoreboard). Subscribed regardless of contest status so the final
  // migration event at contest end still arrives.
  useEffect(() => {
    if (!contestId || !user || !isRealtimeSupported()) {
      return undefined;
    }
    const unsubscribe = subscribeScoreboard(contestId, () => {
      void fetchScoreboard();
    }, {
      onStreamDown: () => setRealtimeDown(true),
    });
    return unsubscribe;
  }, [contestId, fetchScoreboard, user]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    // XSYS-012: keep polling through 'finishing' too — the scoreboard is
    // still live there (final submissions land, then the migration rewrites
    // it). Stopping at 'running' left the page silently stale for the whole
    // finishing window, especially for guests who never get SSE pings.
    if (contest?.status === 'running' || contest?.status === 'finishing') {
      const intervalMs = realtimeDown
        ? REALTIME.SCOREBOARD_POLL_WHEN_STREAM_DOWN_MS
        : REALTIME.SCOREBOARD_FALLBACK_POLL_MS;
      interval = setInterval(() => {
        void fetchScoreboard();
      }, intervalMs);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [contest?.status, fetchScoreboard, realtimeDown]);

  return {
    contest,
    scoreboard,
    problems,
    loading,
    error,
    lastUpdate,
    connected: Boolean(user) && isRealtimeSupported() && !realtimeDown,
    status: status ?? contest?.status ?? null,
    startTime: startTime ?? contest?.start_time ?? null,
  };
};

export default useContestScoreboard;
