import { StatusBadge } from '../../components/ui';
import type { ProblemBase } from '../../types';
import styles from './HeaderProblemBadge.module.css';

const HINT = 'Header problem: submit a header file, not a whole program';

/**
 * Marks a header problem in the contest problem lists (A7-06): it takes a
 * single header file, not a whole program. The table shows the neutral
 * HEADER StatusBadge the admin Problems table uses; the narrow contest
 * sidebar shows a compact ".h" in the same tint, so the title keeps its room
 * (screen readers hear "Header problem" either way).
 */
export function HeaderProblemBadge({ problem, compact = false }: {
  problem: Pick<ProblemBase, 'problem_type'>;
  compact?: boolean;
}) {
  if (problem.problem_type !== 'header') return null;
  if (!compact) return <StatusBadge title={HINT}>HEADER</StatusBadge>;
  return (
    <StatusBadge soft title={HINT} className={styles.compact}>
      <span aria-hidden="true">.h</span>
      <span className={styles.srOnly}>Header problem</span>
    </StatusBadge>
  );
}
