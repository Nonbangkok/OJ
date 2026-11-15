import { Check, Circle, CircleNotch, Timer, X } from '@phosphor-icons/react';
import type { TestCaseResult } from '../../types';
import { passedCount, verdictLabel, verdictTone, type VerdictTone } from './verdictStatus';
import styles from './Verdict.module.css';

export function StatusMark({ tone, size = 14 }: { tone: VerdictTone; size?: number }) {
  const props = { size, 'aria-hidden': true as const, className: styles[tone] };
  switch (tone) {
    case 'pass': return <Check weight="bold" {...props} />;
    case 'fail': return <X weight="bold" {...props} />;
    case 'limit': return <Timer weight="bold" {...props} />;
    case 'pending': return <CircleNotch {...props} />;
    default: return <Circle {...props} />;
  }
}

export function VerdictText({ status, results }: { status: string | null | undefined; results?: TestCaseResult[] | null }) {
  const tone = verdictTone(status);
  return (
    <span className={`${styles.verdict} ${styles[tone]}`}>
      <StatusMark tone={tone} />
      <span>{verdictLabel(status, results)}</span>
    </span>
  );
}

const MAX_SEGMENTS = 20;

export function TestcaseStrip({ results, size = 'sm' }: { results: TestCaseResult[]; size?: 'sm' | 'lg' }) {
  const passed = passedCount(results);
  const label = `${passed} of ${results.length} test cases passed`;
  const sizeClass = size === 'lg' ? styles.lg : styles.sm;

  if (results.length > MAX_SEGMENTS) {
    const count = (tone: VerdictTone) => results.filter((r) => verdictTone(r.status) === tone).length;
    const parts: Array<[VerdictTone, number]> = [['pass', passed], ['limit', count('limit')], ['fail', count('fail')], ['none', count('none') + count('pending')]];
    return (
      <span role="img" aria-label={label} data-strip="bar" className={`${styles.bar} ${sizeClass}`}>
        {parts.filter(([, n]) => n > 0).map(([tone, n]) => (
          <span key={tone} className={`${styles.fill} ${styles[`fill-${tone}`]}`} style={{ flexGrow: n }} />
        ))}
      </span>
    );
  }

  return (
    <span role="img" aria-label={label} className={`${styles.strip} ${sizeClass}`}>
      {results.map((r, i) => (
        <span key={r.testCase ?? i} data-segment="" className={`${styles.segment} ${styles[`fill-${verdictTone(r.status)}`]}`} />
      ))}
    </span>
  );
}

export function ScoreCell({ score, attempted }: { score: number | null | undefined; attempted: boolean }) {
  if (!attempted || score === null || score === undefined) return <span className={styles.score}>—</span>;
  return <span className={`${styles.score} ${score >= 100 ? styles.pass : ''}`.trim()}>{score}</span>;
}
