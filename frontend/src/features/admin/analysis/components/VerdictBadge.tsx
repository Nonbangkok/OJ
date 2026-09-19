import styles from './VerdictBadge.module.css';

interface VerdictBadgeProps {
  verdict: string;
}

/** Colored chip for a submission verdict, used across the analysis views. */
const VerdictBadge = ({ verdict }: VerdictBadgeProps) => {
  const slug = verdict.toLowerCase().replace(/[^a-z]+/g, '-');
  const colorClass = styles[slug] ?? styles.default;

  return <span className={`${styles.badge} ${colorClass}`.trim()}>{verdict}</span>;
};

export default VerdictBadge;
