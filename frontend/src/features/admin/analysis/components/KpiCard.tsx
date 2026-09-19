import styles from './KpiCard.module.css';

interface KpiCardProps {
  label: string;
  value: number | string;
  /** Delta vs. the previous window as a percentage; null hides the delta. */
  deltaPercent: number | null;
}

const formatDelta = (delta: number): string => `${delta > 0 ? '+' : ''}${Math.round(delta)}%`;

const KpiCard = ({ label, value, deltaPercent }: KpiCardProps) => {
  const deltaClass = deltaPercent === null
    ? ''
    : deltaPercent >= 0
      ? styles['delta-up']
      : styles['delta-down'];

  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {deltaPercent !== null && (
        <span className={`${styles.delta} ${deltaClass}`.trim()}>
          {formatDelta(deltaPercent)}
        </span>
      )}
    </div>
  );
};

export default KpiCard;
