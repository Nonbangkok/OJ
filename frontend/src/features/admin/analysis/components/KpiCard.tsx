import styles from './KpiCard.module.css';

interface KpiCardProps {
  label: string;
  value: number | string;
  /** Delta vs. the previous window as a percentage; null hides the delta. */
  deltaPercent: number | null;
  /** The window it compares against, e.g. "30d"; detail views without a window omit it. */
  comparison?: string;
}

/** "▲ 12% vs prev. 30d" — neutral on purpose: more submissions isn't good or bad by itself. */
const formatDelta = (delta: number, comparison?: string): string => {
  const rounded = Math.round(Math.abs(delta));
  const arrow = rounded === 0 ? '' : delta > 0 ? '▲ ' : '▼ ';
  return comparison ? `${arrow}${rounded}% vs prev. ${comparison}` : `${arrow}${rounded}%`;
};

const KpiCard = ({ label, value, deltaPercent, comparison }: KpiCardProps) => (
  <div className={styles.card}>
    <span className={styles.label}>{label}</span>
    <span className={styles.value}>{value}</span>
    {deltaPercent !== null && <span className={styles.delta}>{formatDelta(deltaPercent, comparison)}</span>}
  </div>
);

export default KpiCard;
