import styles from './Home.parts.module.css';

/** Heatmap level for a day's solved count: 0 / 1 / 2 / 3–4 / 5+ (§7.1). */
export function weekLevel(solved: number): 0 | 1 | 2 | 3 | 4 {
  if (solved <= 0) return 0;
  if (solved === 1) return 1;
  if (solved === 2) return 2;
  if (solved <= 4) return 3;
  return 4;
}

const dayDate = (day: string) => new Date(`${day}T00:00:00`);
const LETTER = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' });
const TITLE = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** The last seven days of distinct problems solved, oldest first; today is last. */
export default function WeekStrip({ week, currentStreak }: { week: { day: string; solved: number }[]; currentStreak: number }) {
  const total = week.reduce((sum, d) => sum + d.solved, 0);
  return (
    <div className={styles.week}>
      <ol className={styles.weekDays} aria-label="Problems solved per day this week">
        {week.map((d, i) => {
          const today = i === week.length - 1;
          const date = dayDate(d.day);
          return (
            <li key={d.day} className={styles.weekDay}>
              <span
                data-testid="week-day"
                data-level={weekLevel(d.solved)}
                {...(today ? { 'data-today': 'true' } : {})}
                className={styles.weekCell}
                title={`${TITLE.format(date).replace(',', '')} · ${d.solved} solved`}
              />
              <span className={styles.weekLetter} aria-hidden="true">{LETTER.format(date)}</span>
            </li>
          );
        })}
      </ol>
      <div className={styles.weekLegend} aria-hidden="true">
        <span>less</span>
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={styles.weekCellSmall} data-level={l} />)}
        <span>more</span>
      </div>
      <p className={styles.meta}>{`${total} solved this week · ${currentStreak}-day run`}</p>
    </div>
  );
}
