import type { CategoryStat } from '../../types';
import styles from './ProblemSolvingProfile.module.css';

/** Secondary readout beside the radar: exact values as a light 3-column
 *  grid so the chart is never the only representation (accessibility). */
export default function CategorySummary({ categories }: { categories: CategoryStat[] }) {
  return (
    <ul className={styles.summaryGrid} aria-label="Solved problems by category">
      {categories.map((stat) => (
        <li key={stat.category} className={stat.solved > 0 ? styles.summaryItem : styles.summaryItemEmpty}>
          <span className={styles.summaryName}>{stat.category}</span>
          <span className={styles.summaryValue}>{stat.solved}</span>
        </li>
      ))}
    </ul>
  );
}
