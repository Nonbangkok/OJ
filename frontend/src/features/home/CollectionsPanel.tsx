import { Link } from 'react-router-dom';
import { ProgressBar } from '../../components/ui';
import type { CollectionProgress } from '../../types';
import styles from './Home.parts.module.css';

/** Per-collection solved/total, linking to the filtered problem list. */
export default function CollectionsPanel({ collections }: { collections: CollectionProgress[] }) {
  if (collections.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby="home-collections">
      <h2 id="home-collections" className={styles.sectionLabel}>Collections</h2>
      <ul className={styles.collections}>
        {collections.map((c) => (
          <li key={c.id}>
            <Link to={`/problems?collection=${c.id}`} className={styles.collectionRow}>
              <span className={styles.collectionName}>{c.name}</span>
              <span className={styles.monoRight}>{`${c.solved}/${c.total}`}</span>
            </Link>
            <ProgressBar value={c.solved} max={c.total} label={`${c.name}: ${c.solved} of ${c.total} solved`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
