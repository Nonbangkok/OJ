import { useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { CategoryStat } from '../../types';
import styles from './ProblemSolvingProfile.module.css';

/** Compact display labels keep the crowded axis ring readable; tooltips
 *  always show the full category name. */
const COMPACT_LABELS: Record<string, string> = {
  'Dynamic Programming': 'DP',
  'Divide and Conquer': 'D&C',
  'Data Structures': 'Data Structures',
  '2D-Grid': '2D Grid',
};

const compactLabel = (category: string): string => COMPACT_LABELS[category] ?? category;

/** Sensible rounded radar maximum: the largest count rounded up to a clean
 *  step (1→5, 6→10, 17→20, 43→50 …) so values keep their proportions. */
const roundedMax = (max: number): number => {
  if (max <= 0) return 5;
  const step = max <= 10 ? 5 : max <= 100 ? 10 : max <= 1000 ? 100 : 1000;
  return Math.ceil(max / step) * step;
};

interface TooltipEntry {
  payload: CategoryStat;
}

const CategoryTooltip = ({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) => {
  if (!active || !payload?.length) return null;
  const stat = payload[0].payload;
  return (
    <div className={styles.radarTooltip}>
      <span className={styles.radarTooltipCategory}>{stat.category}</span>
      <span className={styles.radarTooltipValue}>{stat.solved} solved</span>
    </div>
  );
};

export default function CategoryRadarChart({ categories }: { categories: CategoryStat[] }) {
  const [compact, setCompact] = useState(false);
  const data = categories.map((stat) => ({ ...stat, label: compactLabel(stat.category) }));
  const maxSolved = categories.reduce((max, stat) => Math.max(max, stat.solved), 0);
  const domainMax = roundedMax(maxSolved);
  const hasData = maxSolved > 0;

  return (
    <div
      className={styles.radarWrap}
      // Recharts ResponsiveContainer observes its parent; a width observer
      // switches to compact axis labels when the radar gets narrow. The
      // guard keeps jsdom (no ResizeObserver) working in tests.
      ref={(node) => {
        if (!node || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width ?? 0;
          const narrow = width > 0 && width < 480;
          setCompact((previous) => (previous !== narrow ? narrow : previous));
        });
        observer.observe(node);
      }}
    >
      <ResponsiveContainer width="100%" height={compact ? 300 : 380}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="var(--border-color)" />
          <PolarAngleAxis
            dataKey={compact ? 'label' : 'category'}
            tick={{ fill: 'var(--text-secondary)', fontSize: compact ? 11 : 12 }}
          />
          <PolarRadiusAxis
            domain={[0, domainMax]}
            tickCount={5}
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            stroke="var(--border-color)"
            angle={90}
          />
          <Radar
            dataKey="solved"
            stroke="var(--accent-primary)"
            fill="var(--accent-primary)"
            fillOpacity={0.25}
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--accent-primary)', stroke: 'var(--surface-elevated)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Tooltip content={<CategoryTooltip />} />
        </RadarChart>
      </ResponsiveContainer>
      {!hasData && (
        <p className={styles.radarEmpty} role="status">
          No solved problems yet — solve problems to build your problem-solving profile.
        </p>
      )}
    </div>
  );
}
