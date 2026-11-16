import { useMemo } from 'react';
import { useTheme } from '../../../context/ThemeContext';

export interface ChartColorSet {
  text: string;
  grid: string;
  series: string[];
}

// Neutral-first palette (UI redesign 2026-11): ink, then the verdict hues.
const LIGHT: ChartColorSet = {
  text: '#71717a',
  grid: '#e4e4e7',
  series: ['#18181b', '#16a34a', '#dc2626', '#b45309', '#71717a', '#9a3412', '#a1a1aa', '#3f3f46'],
};

const DARK: ChartColorSet = {
  text: '#8b949e',
  grid: '#30363d',
  series: ['#e6edf3', '#3fb950', '#f85149', '#d29922', '#8b949e', '#f0883e', '#6e7681', '#c9d1d9'],
};

/** Series colors for verdict categories, keyed by verdict name. */
export const VERDICT_COLORS: Record<string, string> = {
  Accepted: '#16a34a',
  'Wrong Answer': '#dc2626',
  'Time Limit Exceeded': '#d97706',
  'Memory Limit Exceeded': '#ea580c',
  'Runtime Error': '#9a3412',
  'Compilation Error': '#71717a',
  'System Error': '#a1a1aa',
  Skipped: '#d4d4d8',
};

/** Theme-aware chart colors for the analysis tab. */
export const useChartColors = (): ChartColorSet => {
  const { theme } = useTheme();
  return theme === 'dark' ? DARK : LIGHT;
};

/** The daily bars' stack, bottom up: one series per verdict bucket and its colour token. */
export const DAILY_VERDICT_SERIES = [
  { key: 'accepted', label: 'Accepted', token: '--verdict-accepted', fallback: VERDICT_COLORS.Accepted },
  { key: 'wrong', label: 'Wrong Answer', token: '--verdict-wrong', fallback: VERDICT_COLORS['Wrong Answer'] },
  { key: 'time', label: 'Time Limit', token: '--verdict-time', fallback: VERDICT_COLORS['Time Limit Exceeded'] },
  { key: 'memory', label: 'Memory Limit', token: '--verdict-memory', fallback: VERDICT_COLORS['Memory Limit Exceeded'] },
  { key: 'runtime', label: 'Runtime Error', token: '--verdict-runtime', fallback: VERDICT_COLORS['Runtime Error'] },
  { key: 'compilation', label: 'Compilation Error', token: '--verdict-compilation', fallback: VERDICT_COLORS['Compilation Error'] },
  { key: 'other', label: 'Other', token: '--verdict-pending', fallback: VERDICT_COLORS['System Error'] },
] as const;

export type DailyVerdictKey = typeof DAILY_VERDICT_SERIES[number]['key'];

const VERDICT_KEYS: Record<string, DailyVerdictKey> = {
  Accepted: 'accepted', 'Wrong Answer': 'wrong', 'Time Limit Exceeded': 'time', 'Memory Limit Exceeded': 'memory',
  'Runtime Error': 'runtime', 'Compilation Error': 'compilation',
};

/** The colour bucket for a verdict name; everything else is "other". */
export const verdictKeyOf = (verdict: string): DailyVerdictKey => VERDICT_KEYS[verdict] ?? 'other';

/**
 * SVG presentation attributes can't take var(), so the verdict tokens are
 * resolved to their computed values for the active theme (falling back to
 * the fixed palette where a token is missing, e.g. in tests).
 */
export const useVerdictColors = (): Record<DailyVerdictKey, string> => {
  const { theme } = useTheme();
  return useMemo(() => {
    void theme; // the theme switch changes which token values apply
    const computed = typeof window !== 'undefined' ? window.getComputedStyle(document.documentElement) : null;
    const out = {} as Record<DailyVerdictKey, string>;
    for (const series of DAILY_VERDICT_SERIES) {
      out[series.key] = computed?.getPropertyValue(series.token).trim() || series.fallback;
    }
    return out;
  }, [theme]);
};
