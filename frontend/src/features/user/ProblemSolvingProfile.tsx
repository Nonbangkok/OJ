import { useState } from 'react';
import type { CategoryStat } from '../../types';
import CategoryRadarChart from './CategoryRadarChart';
import CategorySummary from './CategorySummary';
import styles from './ProblemSolvingProfile.module.css';

interface ProblemSolvingProfileProps {
  categories: CategoryStat[];
}

/** Fewer axes than this make a meaningless radar; the list stands alone. */
const MIN_RADAR_AXES = 3;

/**
 * Categories: a radar (decorative, aria-hidden) beside the solved / total /
 * % list that carries the numbers. Hovering a list row or a radar point
 * highlights the other. Only categories that have problems are charted.
 */
export default function ProblemSolvingProfile({ categories }: ProblemSolvingProfileProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const charted = categories.filter((stat) => stat.total > 0);
  const showRadar = charted.length >= MIN_RADAR_AXES;
  return (
    <section className={styles.section} aria-labelledby="profile-categories">
      <div className={styles.head}>
        <h2 id="profile-categories">Categories</h2>
        <span className={styles.headMeta}>solved / problems</span>
      </div>
      <div className={showRadar ? styles.profileBody : styles.listOnly}>
        {showRadar && (
          <div className={styles.radarColumn} aria-hidden="true">
            <CategoryRadarChart categories={categories} activeIndex={activeIndex} onActiveChange={setActiveIndex} />
          </div>
        )}
        <CategorySummary categories={charted} activeIndex={activeIndex} onActiveChange={setActiveIndex} />
      </div>
    </section>
  );
}
