import type { CategoryStat } from '../../types';
import styles from './ProblemSolvingProfile.module.css';

/** Clean percentage text: 100%, 66.7% — never trailing zeros. */
const percentText = (percentage: number): string =>
  `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`;

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
          <span className={styles.summaryValue}>{percentText(stat.percentage)}</span>
        </li>
      ))}
    </ul>
  );
}
