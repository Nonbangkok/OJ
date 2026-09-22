import type { CategoryStat } from '../../types';
import CategoryRadarChart from './CategoryRadarChart';
import CategorySummary from './CategorySummary';
import styles from './ProblemSolvingProfile.module.css';

interface ProblemSolvingProfileProps {
  categories: CategoryStat[];
}

/** Radar + compact summary of solved problems per category. Section styling
 *  reuses the Profile page's shared card (.section) visual language. */
export default function ProblemSolvingProfile({ categories }: ProblemSolvingProfileProps) {
  return (
    <section className={styles.section} aria-label="Problem Solving Profile">
      <h2>Problem Solving Profile</h2>
      <div className={styles.profileBody}>
        <div className={styles.radarColumn}>
          <CategoryRadarChart categories={categories} />
        </div>
        <CategorySummary categories={categories} />
      </div>
    </section>
  );
}
