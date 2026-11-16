import { fireEvent, render, screen, within } from '@testing-library/react';
import ProblemSolvingProfile from '../../../features/user/ProblemSolvingProfile';

// The radar is SVG from recharts; this file checks the wiring around it.
jest.mock('../../../features/user/CategoryRadarChart', () => ({
  __esModule: true,
  default: (props: { activeIndex?: number | null }) => <div data-testid="radar" data-active={props.activeIndex ?? ''} />,
}));

const three = [
  { category: 'Dynamic Programming', solved: 4, total: 6, percentage: 66.7 },
  { category: 'Math', solved: 4, total: 4, percentage: 100 },
  { category: 'Graph', solved: 0, total: 5, percentage: 0 },
  { category: 'Strings', solved: 0, total: 0, percentage: 0 },
];

test('radar is hidden from assistive tech and the list carries the numbers', () => {
  render(<ProblemSolvingProfile categories={three} />);
  expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
  expect(screen.getByTestId('radar').closest('[aria-hidden="true"]')).not.toBeNull();
  const list = screen.getByRole('list', { name: 'Solved problems by category' });
  expect(within(list).getByText('Dynamic Programming').closest('li')).toHaveTextContent('4 / 6');
});

test('fewer than three categories with problems shows the list only', () => {
  render(<ProblemSolvingProfile categories={[three[0], three[1], three[3]]} />);
  expect(screen.queryByTestId('radar')).toBeNull();
  expect(screen.getByRole('list', { name: 'Solved problems by category' })).toBeInTheDocument();
});

test('hovering a list row highlights the radar point', () => {
  render(<ProblemSolvingProfile categories={three} />);
  const row = screen.getByText('Math').closest('li') as HTMLElement;
  fireEvent.mouseEnter(row);
  expect(row).toHaveAttribute('data-active', 'true');
  expect(screen.getByTestId('radar')).toHaveAttribute('data-active', '1');
  fireEvent.mouseLeave(row);
  expect(screen.getByTestId('radar')).toHaveAttribute('data-active', '');
});
