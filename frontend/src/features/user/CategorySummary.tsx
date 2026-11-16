import type { CategoryStat } from '../../types';
import styles from './ProblemSolvingProfile.module.css';

/** Clean percentage text: 100%, 66.7% — never trailing zeros. */
const percentText = (stat: CategoryStat): string =>
  stat.total === 0
    ? '—'
    : `${Number.isInteger(stat.percentage) ? stat.percentage : stat.percentage.toFixed(1)}%`;

/**
 * The numbers beside the radar: solved / total and completion per category.
 * Index positions match the radar's axes, so hovering a row highlights its
 * point (and the radar highlights the row).
 */
export default function CategorySummary({
  categories,
  activeIndex = null,
  onActiveChange,
}: {
  categories: CategoryStat[];
  activeIndex?: number | null;
  onActiveChange?: (index: number | null) => void;
}) {
  return (
    <ul className={styles.summaryList} aria-label="Solved problems by category">
      {categories.map((stat, index) => (
        <li
          key={stat.category}
          className={styles.summaryRow}
          data-active={activeIndex === index ? 'true' : undefined}
          onMouseEnter={() => onActiveChange?.(index)}
          onMouseLeave={() => onActiveChange?.(null)}
        >
          <span className={styles.summaryName} title={stat.category}>{stat.category}</span>
          <span className={styles.summaryFraction}>{stat.solved} / {stat.total}</span>
          <span className={styles.summaryValue}>{percentText(stat)}</span>
        </li>
      ))}
    </ul>
  );
}
