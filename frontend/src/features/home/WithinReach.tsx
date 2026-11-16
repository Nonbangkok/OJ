import { Link } from 'react-router-dom';
import type { HomeSummary } from '../../types';
import styles from './Home.parts.module.css';

/** One concrete, completable goal shown under "Within reach". */
export interface Goal {
  key: 'collection' | 'level' | 'run';
  text: string;
  /** Link text naming the problem that completes the goal. */
  linkLabel: string;
  to: string;
}

/**
 * Up to three goals, each only when it applies, in the order collection,
 * level, run (§7.1).
 */
export function goalsFor(summary: HomeSummary): Goal[] {
  const goals: Goal[] = [];
  const almostDone = summary.collections.find((c) => c.total - c.solved === 1 && c.next);
  if (almostDone?.next) {
    goals.push({
      key: 'collection',
      text: `One more to finish ${almostDone.name} · ${almostDone.solved}/${almostDone.total}`,
      linkLabel: almostDone.next.title,
      to: `/problems/${almostDone.next.id}`,
    });
  }
  if (summary.levelUp) {
    const { remaining, problem } = summary.levelUp;
    goals.push({
      key: 'level',
      text: `${remaining} XP to Level ${summary.progression.level + 1}`,
      linkLabel: `${problem.title} gives +${problem.xp} XP`,
      to: `/problems/${problem.id}`,
    });
  }
  const runTarget = summary.continue ?? summary.startWith[0];
  if (summary.currentStreak >= 1 && !summary.solvedToday && runTarget) {
    goals.push({
      key: 'run',
      text: `Solve one today to make it a ${summary.currentStreak + 1}-day run`,
      linkLabel: runTarget.title,
      to: `/problems/${runTarget.id}`,
    });
  }
  return goals.slice(0, 3);
}

export default function WithinReach({ summary }: { summary: HomeSummary }) {
  const goals = goalsFor(summary);
  if (goals.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="within-reach">
      <h2 id="within-reach" className={styles.sectionLabel}>Within reach</h2>
      <ul className={styles.goals}>
        {goals.map((goal) => (
          <li key={goal.key} className={styles.goal}>
            <span className={styles.goalText}>{goal.text}</span>
            <Link to={goal.to} className={styles.goalLink}>
              {goal.linkLabel} <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
