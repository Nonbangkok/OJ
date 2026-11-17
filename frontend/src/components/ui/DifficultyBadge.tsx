import { difficultyBand } from '../../utils/constants';
import styles from './DifficultyBadge.module.css';

export interface DifficultyBadgeProps {
  difficulty: number | null | undefined;
}

/**
 * A problem's difficulty as a tinted badge in its band colour (800–1100 green,
 * 1200–1600 yellow, 1700–2100 orange, 2200–2700 red, 2800–3500 purple), shaped
 * like StatusBadge so it fits the neutral theme. Unrated shows a muted dash.
 */
export function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const band = difficultyBand(difficulty);
  if (difficulty == null || band == null) return <span className={styles.unrated}>—</span>;
  return (
    <span className={`${styles.badge} ${styles[`band${band}`]}`} data-band={band} title={`Difficulty ${difficulty}`}>
      {difficulty}
    </span>
  );
}

export default DifficultyBadge;
