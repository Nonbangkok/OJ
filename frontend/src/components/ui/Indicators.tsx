import type { Contest } from '../../types';
import { useCountdown } from '../shell/useCountdown';
import styles from './Indicators.module.css';

type ContestClock = Pick<Contest, 'status' | 'start_time' | 'end_time'>;

/** State-aware contest clock: ENDS IN / STARTS IN / JUDGING / ENDED. */
export function Countdown({ contest }: { contest: ContestClock }) {
  const target = contest.status === 'running' ? contest.end_time : contest.status === 'scheduled' ? contest.start_time : null;
  const { label } = useCountdown(target);
  let text: string;
  if (contest.status === 'running') text = `ENDS IN ${label}`;
  else if (contest.status === 'scheduled') text = `STARTS IN ${label}`;
  else if (contest.status === 'finishing') text = 'JUDGING';
  else text = 'ENDED';
  const absolute = target ? new Date(target).toLocaleString() : undefined;
  return <span className={styles.countdown} title={absolute} aria-live="off">{text}</span>;
}

export function ProgressBar({ value, max, label, tone = 'neutral' }: { value: number; max: number; label: string; tone?: 'neutral' | 'pass' }) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      className={styles.track}
    >
      <span className={`${styles.fill} ${tone === 'pass' ? styles.fillPass : ''}`.trim()} style={{ width: `${(clamped / safeMax) * 100}%` }} />
    </span>
  );
}

export function StatusDot({ tone = 'neutral', label }: { tone?: 'neutral' | 'pass' | 'warn' | 'fail'; label: string }) {
  return (
    <span className={styles.dot} data-tone={tone}>
      <span className={styles.dotMark} aria-hidden="true" />
      {label}
    </span>
  );
}
