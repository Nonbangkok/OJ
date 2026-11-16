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

/** Ticking countdown to `target`; stops at zero. */
export function useCountdown(target: string | Date | null): Countdown {
  const targetMs = target === null ? null : new Date(target).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (targetMs === null) return undefined;
    // Tick once immediately so a new target is never shown against a stale clock.
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(() => {
      tick();
      if (Date.now() >= targetMs) window.clearInterval(timer);
    }, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [targetMs]);

  if (targetMs === null) return { remainingMs: 0, label: '', done: true };
  const remainingMs = Math.max(0, targetMs - now);
  return { remainingMs, label: formatRemaining(remainingMs), done: remainingMs === 0 };
}
