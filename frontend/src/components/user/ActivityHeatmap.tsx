import { useMemo } from 'react';

import type { UserProfileDailyActivity } from '../../types';

import styles from './ActivityHeatmap.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_IN_WINDOW = 365;
const WEEKS = Math.ceil(DAYS_IN_WINDOW / 7);

const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const levelFor = (count: number): number => {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
};

type HeatmapCell = { day: string; count: number; level: number };

const buildCells = (activity: UserProfileDailyActivity[]): HeatmapCell[][] => {
  const counts = new Map(activity.map((entry) => [entry.day, entry.count]));

  // The grid ends on the Saturday of the current week so columns are complete weeks.
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const cells: HeatmapCell[] = [];
  for (let i = DAYS_IN_WINDOW - 1; i >= 0; i--) {
    const date = new Date(end.getTime() - i * DAY_MS);
    const future = date.getTime() > today.getTime();
    const day = isoDay(date);
    const count = counts.get(day) ?? 0;
    cells.push({ day, count, level: future ? -1 : levelFor(count) });
  }

  const weeks: HeatmapCell[][] = [];
  for (let week = 0; week < WEEKS; week++) {
    weeks.push(cells.slice(week * 7, week * 7 + 7));
  }
  return weeks;
};

const ActivityHeatmap = ({ activity }: { activity: UserProfileDailyActivity[] }) => {
  const weeks = useMemo(() => buildCells(activity), [activity]);

  return (
    <div className={styles.heatmap} role="img" aria-label="Daily submission activity over the past year">
      {weeks.map((week, weekIndex) => (
        <div key={weekIndex} className={styles.column}>
          {week.map((cell) => (
            <span
              key={cell.day}
              className={`${styles.cell} ${styles[`level-${cell.level}`]}`}
              title={cell.level < 0 ? undefined : `${cell.day}: ${cell.count} submission${cell.count === 1 ? '' : 's'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default ActivityHeatmap;
