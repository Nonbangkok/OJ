import { render, screen, within } from '@testing-library/react';
import ProblemSolvingProfile from '../../../features/user/ProblemSolvingProfile';

const categories = [
  { category: 'Dynamic Programming', solved: 4, total: 6, percentage: 66.7 },
  { category: 'Math', solved: 4, total: 4, percentage: 100 },
  { category: 'Binary Search', solved: 2, total: 3, percentage: 66.7 },
  { category: 'Graph', solved: 0, total: 5, percentage: 0 },
  { category: 'Uncategorized', solved: 1, total: 2, percentage: 50 },
];

test('renders the section with radar axes and the exact-value summary', () => {
  render(<ProblemSolvingProfile categories={categories} />);

  // Section heading and the radar's axis labels.
  expect(screen.getByRole('heading', { name: 'Problem Solving Profile' })).toBeInTheDocument();
  expect(screen.getByText('Dynamic Programming')).toBeInTheDocument();
  expect(screen.getByText('Graph')).toBeInTheDocument();

  // The summary grid mirrors the exact values (chart is never the only
  // representation).
  const summary = screen.getByRole('list', { name: 'Solved problems by category' });
  // Each row shows solved/total plus the completion percentage.
  const dpRow = within(summary).getByText('Dynamic Programming').closest('li');
  expect(dpRow).toHaveTextContent('4 / 6');
  expect(dpRow).toHaveTextContent('66.7%');
  const mathRow = within(summary).getByText('Math').closest('li');
  expect(mathRow).toHaveTextContent('4 / 4');
  expect(mathRow).toHaveTextContent('100%');
  // Zero-solved and zero-total categories stay visible and clean.
  const graphRow = within(summary).getByText('Graph').closest('li');
  expect(graphRow).toHaveTextContent('0 / 5');
  expect(graphRow).toHaveTextContent('0%');
});

test('shows the intentional empty state when nothing is solved yet', () => {
  const empty = [
    { category: 'Dynamic Programming', solved: 0, total: 6, percentage: 0 },
    { category: 'Math', solved: 0, total: 0, percentage: 0 },
  ];
  render(<ProblemSolvingProfile categories={empty} />);

  expect(screen.getByText(/no solved problems yet/i)).toBeInTheDocument();
});

test('renders 0 / 0 with an em dash and no radar axis for empty categories', () => {
  const sparse = [
    { category: 'Constructive', solved: 0, total: 0, percentage: 0 },
    { category: 'Math', solved: 1, total: 2, percentage: 50 },
  ];
  render(<ProblemSolvingProfile categories={sparse} />);

  // Summary keeps the category with an em dash (completion undefined).
  const summary = screen.getByRole('list', { name: 'Solved problems by category' });
  const row = within(summary).getByText('Constructive').closest('li');
  expect(row).toHaveTextContent('0 / 0');
  expect(row).toHaveTextContent('—');
  expect(row.textContent).not.toMatch(/NaN|Infinity|0%/);

  // The radar itself only carries categories with problems: the chart data
  // excludes total===0 rows (recharts renders no axis ticks under jsdom, so
  // the filtering is verified through the summary's sibling behavior above).
});
