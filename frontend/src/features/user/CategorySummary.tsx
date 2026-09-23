import type { CategoryStat } from '../../types';
import styles from './ProblemSolvingProfile.module.css';

/** Clean percentage text: 100%, 66.7% — never trailing zeros. Categories
 *  with no problems at all show an em dash: completion is undefined. */
const percentText = (stat: CategoryStat): string =>
  stat.total === 0
    ? '—'
    : `${Number.isInteger(stat.percentage) ? stat.percentage : stat.percentage.toFixed(1)}%`;

/** Secondary readout beside the radar: solved/total with the completion
 *  percentage, as a light grid so the chart is never the only
 *  representation (accessibility). */
export default function CategorySummary({ categories }: { categories: CategoryStat[] }) {
  return (
    <ul className={styles.summaryGrid} aria-label="Solved problems by category">
      {categories.map((stat) => (
        <li key={stat.category} className={stat.solved > 0 ? styles.summaryItem : styles.summaryItemEmpty}>
          <span className={styles.summaryName} title={stat.category}>{stat.category}</span>
          <span className={styles.summaryFraction}>{stat.solved} / {stat.total}</span>
          <span className={styles.summaryValue}>{percentText(stat)}</span>
        </li>
      ))}
    </ul>
  );
}
