import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:MM:SS` under a day, `Nd HH:MM` beyond; never negative. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export interface Countdown {
  remainingMs: number;
  label: string;
  done: boolean;
}

const read = (target: number | null): Countdown => {
  if (target === null) return { remainingMs: 0, label: '', done: true };
  const remainingMs = Math.max(0, target - Date.now());
  return { remainingMs, label: formatRemaining(remainingMs), done: remainingMs === 0 };
};

/** Ticking countdown to `target`; stops at zero. */
export function useCountdown(target: string | Date | null): Countdown {
  const targetMs = target === null ? null : new Date(target).getTime();
  const [state, setState] = useState<Countdown>(() => read(targetMs));

  useEffect(() => {
    setState(read(targetMs));
    if (targetMs === null || targetMs <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const next = read(targetMs);
      setState(next);
      if (next.done) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [targetMs]);

  return state;
}
