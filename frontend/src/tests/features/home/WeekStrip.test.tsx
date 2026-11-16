import { render, screen } from '@testing-library/react';
import WeekStrip, { weekLevel } from '../../../features/home/WeekStrip';

describe('weekLevel', () => {
  it.each([[0, 0], [1, 1], [2, 2], [3, 3], [4, 3], [5, 4], [9, 4]])('%i solved → level %i', (solved, level) => {
    expect(weekLevel(solved)).toBe(level);
  });
});

describe('WeekStrip', () => {
  const week = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']
    .map((day, i) => ({ day, solved: [1, 4, 0, 2, 6, 1, 0][i] }));

  it('marks today, labels each day with its count, and totals the week', () => {
    render(<WeekStrip week={week} currentStreak={5} />);
    const cells = screen.getAllByTestId('week-day');
    expect(cells).toHaveLength(7);
    expect(cells[6]).toHaveAttribute('data-today', 'true');
    expect(cells[0]).not.toHaveAttribute('data-today');
    expect(cells[4]).toHaveAttribute('data-level', '4');
    expect(cells[1]).toHaveAttribute('title', 'Wed 11 Nov · 4 solved');
    expect(screen.getByText('14 solved this week · 5-day run')).toBeInTheDocument();
  });
});
