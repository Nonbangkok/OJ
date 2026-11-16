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
