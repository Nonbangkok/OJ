import { render, screen } from '@testing-library/react';

import ActivityHeatmap from '../../components/user/ActivityHeatmap';

const isoDaysAgo = (n: number): string => {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('ActivityHeatmap', () => {
  it('renders the heatmap with an accessible description', () => {
    render(<ActivityHeatmap activity={[]} />);

    expect(screen.getByRole('img', { name: /daily submission activity/i })).toBeInTheDocument();
  });

  it('renders a 365-day grid of cells', () => {
    const { container } = render(<ActivityHeatmap activity={[]} />);

    // 53 week columns x 7 rows (future days render dimmed, not skipped).
    const cells = container.querySelectorAll(`.${'cell'}`);
    expect(cells.length).toBe(365 + 5); // grid cells + 5 legend swatches
  });

  it('shows a title tooltip with the count for active days', () => {
    const activity = [{ day: isoDaysAgo(1), count: 3 }];
    const { container } = render(<ActivityHeatmap activity={activity} />);

    const titled = Array.from(container.querySelectorAll('span[title]'));
    expect(titled.some((el) => el.getAttribute('title')?.includes('3 submission'))).toBe(true);
  });

  it('marks active days with a non-zero level class', () => {
    const activity = [
      { day: isoDaysAgo(1), count: 1 },
      { day: isoDaysAgo(2), count: 7 },
    ];
    const { container } = render(<ActivityHeatmap activity={activity} />);

    const levelled = Array.from(container.querySelectorAll('[class*="level-"]'));
    expect(levelled.some((el) => el.className.includes('level-1'))).toBe(true);
    expect(levelled.some((el) => el.className.includes('level-3'))).toBe(true);
  });

  it('renders the Less/More legend', () => {
    render(<ActivityHeatmap activity={[]} />);

    expect(screen.getByText('Less')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });
});
