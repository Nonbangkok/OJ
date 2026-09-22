import { render, screen, within } from '@testing-library/react';
import ProblemSolvingProfile from '../../../features/user/ProblemSolvingProfile';

const categories = [
  { category: 'Dynamic Programming', solved: 4 },
  { category: 'Math', solved: 4 },
  { category: 'Binary Search', solved: 2 },
  { category: 'Graph', solved: 0 },
  { category: 'Uncategorized', solved: 1 },
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
  // Exact values per category: check within each row.
  const dpRow = within(summary).getByText('Dynamic Programming').closest('li');
  expect(dpRow).toHaveTextContent('4');
  const bsRow = within(summary).getByText('Binary Search').closest('li');
  expect(bsRow).toHaveTextContent('2');
  // Zero-value categories stay visible in the summary.
  const graphRow = within(summary).getByText('Graph').closest('li');
  expect(graphRow).toHaveTextContent('0');
});

test('shows the intentional empty state when nothing is solved yet', () => {
  const empty = [
    { category: 'Dynamic Programming', solved: 0 },
    { category: 'Math', solved: 0 },
  ];
  render(<ProblemSolvingProfile categories={empty} />);

  expect(screen.getByText(/no solved problems yet/i)).toBeInTheDocument();
});
