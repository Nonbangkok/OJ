import { useTheme } from '../../../context/ThemeContext';

export interface ChartColorSet {
  text: string;
  grid: string;
  series: string[];
}

const LIGHT: ChartColorSet = {
  text: '#495057',
  grid: '#e9ecef',
  series: ['#0d6efd', '#198754', '#dc3545', '#ffc107', '#6f42c1', '#fd7e14', '#20c997', '#6610f2'],
};

const DARK: ChartColorSet = {
  text: '#adb5bd',
  grid: '#343a46',
  series: ['#6ea8fe', '#75b798', '#ea868f', '#ffda6a', '#a98cca', '#f78c6b', '#63d2b6', '#9d8cff'],
};

/** Series colors for verdict categories, keyed by verdict name. */
export const VERDICT_COLORS: Record<string, string> = {
  Accepted: '#198754',
  'Wrong Answer': '#dc3545',
  'Time Limit Exceeded': '#ffc107',
  'Memory Limit Exceeded': '#fd7e14',
  'Runtime Error': '#6f42c1',
  'Compilation Error': '#495057',
  'System Error': '#adb5bd',
  Skipped: '#ced4da',
};

/** Theme-aware chart colors for the analysis tab. */
export const useChartColors = (): ChartColorSet => {
  const { theme } = useTheme();
  return theme === 'dark' ? DARK : LIGHT;
};
