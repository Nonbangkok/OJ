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
  'Data Structures': 'DS',
  Sorting: 'Sort',
  '2D-Grid': '2D Grid',
};

const compactLabel = (category: string): string => COMPACT_LABELS[category] ?? category;

/** Rendered radar point; the active one (hovered here or in the list) is larger. */
const pointFor = (activeIndex: number | null) => function RadarPoint(props: { cx?: number; cy?: number; index?: number }) {
  const active = props.index === activeIndex;
  return (
    <circle cx={props.cx} cy={props.cy} r={active ? 5 : 3} fill="var(--accent-primary)" stroke="var(--background-primary)" strokeWidth={1.5} />
  );
};

/** Clean percentage text: 100%, 66.7%, 33.3% — never trailing zeros. */
const percentText = (percentage: number): string =>
  `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`;

interface TooltipEntry {
  payload: CategoryStat;
}

const CategoryTooltip = ({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) => {
  if (!active || !payload?.length) return null;
  const stat = payload[0].payload;
  return (
    <div className={styles.radarTooltip}>
      <span className={styles.radarTooltipCategory}>{stat.category}</span>
      <span className={styles.radarTooltipValue}>{stat.solved} / {stat.total} solved</span>
      <span className={styles.radarTooltipValue}>{percentText(stat.percentage)} complete</span>
    </div>
  );
};

export default function CategoryRadarChart({
  categories,
  activeIndex = null,
  onActiveChange,
}: {
  categories: CategoryStat[];
  /** Index into the charted (total > 0) categories, shared with the list. */
  activeIndex?: number | null;
  onActiveChange?: (index: number | null) => void;
}) {
  const [compact, setCompact] = useState(false);
  // Categories with no problems at all (total 0) have an undefined completion
  // — they stay in the summary as "0 / 0 —" but leave the radar, where a 0
  // point would read as "0% complete" and mislead.
  const data = categories
    .filter((stat) => stat.total > 0)
    .map((stat) => ({ ...stat, label: compactLabel(stat.category) }));
  const hasData = categories.some((stat) => stat.solved > 0);

  return (
    <div
      className={styles.radarWrap}
      // The radar fills its container's usable area (tight margins, large
      // outer radius). A width observer switches to compact axis labels when
      // the radar gets narrow; the guard keeps jsdom (no ResizeObserver)
      // working in tests.
      ref={(node) => {
        if (!node || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width ?? 0;
          const narrow = width > 0 && width < 360;
          setCompact((previous) => (previous !== narrow ? narrow : previous));
        });
        observer.observe(node);
      }}
    >
      <ResponsiveContainer width="100%" height={compact ? 320 : 420}>
        <RadarChart
          data={data}
          // Horizontal margin buys room for the left/right axis labels
          // (e.g. "Implementation") without shrinking the radar: the radius
          // ratio is unchanged, only the label ring gets the slack. The left
          // gets extra room — its labels are the longest on the ring.
          margin={{ top: 12, right: 30, bottom: 12, left: 72 }}
          outerRadius="80%"
          onMouseMove={(state: { activeTooltipIndex?: number | string | null }) => {
            const index = Number(state?.activeTooltipIndex);
            onActiveChange?.(Number.isInteger(index) ? index : null);
          }}
          onMouseLeave={() => onActiveChange?.(null)}
        >
          <PolarGrid stroke="var(--border-color)" />
          <PolarAngleAxis
            dataKey={compact ? 'label' : 'category'}
            tick={{ fill: 'var(--text-secondary)', fontSize: compact ? 11 : 12 }}
          />
          {/* Completion is always 0-100%: a fixed domain (never adaptive),
              with only the key ring levels labeled to stay subtle. */}
          <PolarRadiusAxis
            domain={[0, 100]}
            tickCount={5}
            // Only the meaningful reference rings are labeled (50/100); the
            // center 0% adds noise without information.
            tickFormatter={(value: number) => (value === 50 || value === 100 ? `${value}%` : '')}
            stroke="var(--border-color)"
            angle={90}
            // The radius axis points straight down at the first category
            // axis, so the 100% ring label lands on that axis's label. A
            // dy offset nudges the ring labels just below the label ring
            // instead of repositioning the axis.
            tick={{ fill: 'var(--text-muted)', fontSize: 9, dy: 12, opacity: 0.85 }}
          />
          {/* Theme tokens only (§7.6): ink area at 12%, border-coloured rings. */}
          <Radar
            dataKey="percentage"
            stroke="var(--accent-primary)"
            fill="var(--accent-primary)"
            fillOpacity={0.12}
            strokeWidth={1.75}
            dot={pointFor(activeIndex)}
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
