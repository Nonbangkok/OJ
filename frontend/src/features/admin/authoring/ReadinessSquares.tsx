import type { ReadinessKey, ReadinessState } from './readiness';
import styles from './AuthoringHub.module.css';

const ORDER: Array<[Exclude<ReadinessKey, 'generator'>, string]> = [
  ['statement', 'Statement'], ['solution', 'Solution'], ['testcases', 'Testcases'], ['pdf', 'PDF'], ['verified', 'Verified'],
];
export const READINESS_WORDS: Record<ReadinessState, string> = { done: 'done', stale: 'out of date', failed: 'failed', todo: 'not yet' };

/** Five 9 px squares: Statement · Solution · Testcases · PDF · Verified (the generator is optional and not shown). */
export default function ReadinessSquares({ states }: { states: Record<ReadinessKey, ReadinessState> }) {
  const label = ORDER.map(([key, name]) => `${name} ${READINESS_WORDS[states[key]]}`).join(', ');
  return (
    <span className={styles.squares} role="img" aria-label={label} title={label}>
      {ORDER.map(([key]) => <span key={key} className={styles.square} data-state={states[key]} />)}
    </span>
  );
}

/** The key under the list. */
export function ReadinessLegend() {
  return (
    <p className={styles.legend}>
      <span>Ready = Statement · Solution · Testcases · PDF · Verified</span>
      {(['done', 'stale', 'failed', 'todo'] as ReadinessState[]).map((s) => (
        <span key={s}><span className={styles.square} data-state={s} />{READINESS_WORDS[s]}</span>
      ))}
    </p>
  );
}
