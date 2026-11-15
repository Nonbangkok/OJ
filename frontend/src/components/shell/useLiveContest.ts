import { useEffect, useState } from 'react';
import contestService from '../../services/contestService';
import { useAuth } from '../../context/AuthContext';
import type { Contest } from '../../types';

const REFRESH_MS = 60_000;

/** The running contest that ends soonest, for the sidebar pin; null for guests or when none runs. */
export function useLiveContest(): Contest | null {
  const { user } = useAuth();
  const [live, setLive] = useState<Contest | null>(null);
  const loggedIn = Boolean(user);

  useEffect(() => {
    if (!loggedIn) {
      setLive(null);
      return undefined;
    }
    let cancelled = false;
    const load = () => {
      contestService.getAll()
        .then((contests) => {
          if (cancelled) return;
          const running = contests
            .filter((c) => c.status === 'running')
            .sort((a, b) => new Date(a.end_time).getTime() - new Date(b.end_time).getTime());
          setLive(running[0] ?? null);
        })
        .catch(() => { if (!cancelled) setLive(null); });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [loggedIn]);

  return live;
}
