import { CheckCircle, Circle, CircleHalf, XCircle, ClockCounterClockwise, BookOpenText } from '@phosphor-icons/react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { ReadinessState } from './readiness';
import styles from './Workspace.module.css';

export type StepPath = 'metadata' | 'statement' | 'solution' | 'generator' | 'testcases' | 'verify';
export const STEP_LABELS: Record<StepPath, string> = {
  metadata: 'Metadata', statement: 'Statement', solution: 'Solution', generator: 'Generator', testcases: 'Testcases', verify: 'Verify & publish',
};
const WORDS: Record<ReadinessState, string> = { done: 'done', todo: 'to do', stale: 'out of date', failed: 'failed' };
const GLYPH = { done: CheckCircle, todo: Circle, stale: CircleHalf, failed: XCircle } as const;

/** Step tabs under the workspace header, each with a status glyph; History and AI docs sit right. */
export default function StepTabs({ base, states }: { base: string; states: Record<StepPath, ReadinessState> }) {
  // The draft's plain URL (what the list links to) shows Metadata, so Metadata is current there.
  const onIndex = useLocation().pathname.replace(/\/$/, '') === base;
  return (
    <nav className={styles.steps} aria-label="Draft steps">
      {(Object.keys(STEP_LABELS) as StepPath[]).map((path) => {
        const state = states[path];
        const Icon = GLYPH[state];
        if (path === 'metadata' && onIndex) {
          return (
            <Link key={path} to={`${base}/${path}`} aria-current="page" aria-label={`${STEP_LABELS[path]}, ${WORDS[state]}`}
              title={`${STEP_LABELS[path]}: ${WORDS[state]}`} className={styles.stepActive}>
              <Icon size={14} weight={state === 'todo' ? 'regular' : 'bold'} className={styles[`glyph_${state}`]} aria-hidden="true" />
              {STEP_LABELS[path]}
            </Link>
          );
        }
        return (
          <NavLink
            key={path}
            to={`${base}/${path}`}
            aria-label={`${STEP_LABELS[path]}, ${WORDS[state]}`}
            title={`${STEP_LABELS[path]}: ${WORDS[state]}`}
            className={({ isActive }) => (isActive ? styles.stepActive : styles.step)}
          >
            <Icon size={14} weight={state === 'todo' ? 'regular' : 'bold'} className={styles[`glyph_${state}`]} aria-hidden="true" />
            {STEP_LABELS[path]}
          </NavLink>
        );
      })}
      <span className={styles.stepLinks}>
        <NavLink to={`${base}/jobs`} className={({ isActive }) => (isActive ? styles.stepActive : styles.step)}>
          <ClockCounterClockwise size={14} aria-hidden="true" />History
        </NavLink>
        <NavLink to={`${base}/ai-docs`} className={({ isActive }) => (isActive ? styles.stepActive : styles.step)}>
          <BookOpenText size={14} aria-hidden="true" />AI docs
        </NavLink>
      </span>
    </nav>
  );
}
