import { render, screen } from '@testing-library/react';
import { DifficultyBadge } from '../../../components/ui';

describe('DifficultyBadge', () => {
  it.each([
    [800, 1], [1100, 1], [1200, 2], [1600, 2], [1700, 3], [2100, 3], [2200, 4], [2700, 4], [2800, 5], [3500, 5],
  ])('colours %i with band %i', (difficulty, band) => {
    render(<DifficultyBadge difficulty={difficulty} />);
    const badge = screen.getByText(String(difficulty));
    expect(badge).toHaveAttribute('data-band', String(band));
    expect(badge).toHaveAttribute('title', `Difficulty ${difficulty}`);
  });

  it('an unrated problem shows a muted dash', () => {
    render(<DifficultyBadge difficulty={null} />);
    expect(screen.getByText('—')).not.toHaveAttribute('data-band');
  });
});
