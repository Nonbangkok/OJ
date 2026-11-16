import { useCallback, useEffect, useState } from 'react';
import scoreboardService from '../services/scoreboardService';
import type { GlobalRanking, RankingWindow } from '../types';

/** One page of the global XP ranking for a window, with a retry. */
export const useRanking = (window: RankingWindow, page: number) => {
  const [ranking, setRanking] = useState<GlobalRanking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    scoreboardService.getRanking(window, page)
      .then((data) => { if (!cancelled) { setRanking(data); setError(''); } })
      .catch(() => { if (!cancelled) setError("Couldn't load the ranking."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [window, page, attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setAttempt((a) => a + 1);
  }, []);

  return { ranking, loading, error, retry };
};

export default useRanking;
