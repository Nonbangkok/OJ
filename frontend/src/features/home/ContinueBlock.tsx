import { Link } from 'react-router-dom';
import { Button, TestcaseStrip, VerdictText } from '../../components/ui';
import { formatTimeAgo } from '../../utils/formatters';
import type { HomeContinue, HomeProblemRef, TestCaseResult } from '../../types';
import styles from './Home.parts.module.css';

const asResults = (statuses: string[]): TestCaseResult[] => statuses.map((status) => ({ status }));

/** The most recent unsolved attempt, or the easiest problems to start with. */
export default function ContinueBlock({
  next,
  startWith,
  onContinue,
}: {
  next: HomeContinue | null;
  startWith: HomeProblemRef[];
  onContinue: (id: string) => void;
}) {
  if (next) {
    const results = asResults(next.caseStatuses);
    return (
      <section className={styles.continue} aria-label="Continue">
        <div className={styles.continueHead}>
          <div className={styles.continueTitle}>
            <span className={styles.mono}>{next.id}</span>
            <Link to={`/problems/${next.id}`} className={styles.problemTitle}>{next.title}</Link>
          </div>
          <Button variant="primary" onClick={() => onContinue(next.id)} className={styles.continueButton}>
            Continue <kbd className={styles.kbd} aria-hidden="true">↵</kbd>
          </Button>
        </div>
        {results.length > 0 && <TestcaseStrip results={results} size="lg" />}
        <p className={styles.meta}>
          <VerdictText status={next.latestStatus} results={results} />
          <span>{`${next.attempts} attempt${next.attempts === 1 ? '' : 's'}`}</span>
          <span>{`last tried ${formatTimeAgo(next.lastTriedAt)}`}</span>
        </p>
      </section>
    );
  }
  if (startWith.length === 0) {
    return (
      <section className={styles.continue}>
        <p className={styles.meta}>Every problem is solved. Nice work.</p>
      </section>
    );
  }
  return (
    <section className={styles.continue} aria-labelledby="start-with">
      <h2 id="start-with" className={styles.sectionLabel}>Start with</h2>
      <ul className={styles.startList}>
        {startWith.map((p) => (
          <li key={p.id}>
            <Link to={`/problems/${p.id}`} className={styles.startRow}>
              <span className={styles.mono}>{p.id}</span>
              <span className={styles.problemTitle}>{p.title}</span>
              <span className={styles.monoRight}>{`+${p.xp} XP`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
