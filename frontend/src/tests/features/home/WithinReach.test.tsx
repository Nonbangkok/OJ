import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WithinReach, { goalsFor } from '../../../features/home/WithinReach';
import type { HomeSummary } from '../../../types';

const ref = (id: string, title = id, xp = 40) => ({ id, title, difficulty: 1000, xp });
const base: HomeSummary = {
  progression: { totalXp: 340, level: 2, tier: 'Novice', levelProgress: { current: 240, required: 400, remaining: 160, percentage: 60 }, globalRank: 9 },
  currentStreak: 5,
  solvedToday: false,
  week: [],
  continue: null,
  startWith: [ref('easy', 'Easy one')],
  collections: [
    { id: 1, name: 'vector', solved: 3, total: 10, next: ref('v4') },
    { id: 2, name: 'pair', solved: 9, total: 10, next: ref('pair_ord', 'pair ordering') },
  ],
  levelUp: { remaining: 160, problem: ref('vec_at', 'vector::at', 180) },
};

describe('goalsFor', () => {
  it('lists the collection goal only when exactly one problem is left', () => {
    expect(goalsFor(base)[0]).toEqual({
      key: 'collection', text: 'One more to finish pair · 9/10', linkLabel: 'pair ordering', to: '/problems/pair_ord',
    });
    const none = goalsFor({ ...base, collections: [{ ...base.collections[0] }] });
    expect(none.map((g) => g.key)).not.toContain('collection');
  });

  it('omits the run goal when something was solved today', () => {
    expect(goalsFor(base).map((g) => g.key)).toContain('run');
    expect(goalsFor({ ...base, solvedToday: true }).map((g) => g.key)).not.toContain('run');
    expect(goalsFor({ ...base, currentStreak: 0 }).map((g) => g.key)).not.toContain('run');
  });

  it('caps at three goals in order collection, level, run', () => {
    const goals = goalsFor(base);
    expect(goals.map((g) => g.key)).toEqual(['collection', 'level', 'run']);
    expect(goals[1]).toEqual({ key: 'level', text: '160 XP to Level 3', linkLabel: 'vector::at gives +180 XP', to: '/problems/vec_at' });
    expect(goals[2]).toEqual({ key: 'run', text: 'Solve one today to make it a 6-day run', linkLabel: 'Easy one', to: '/problems/easy' });
  });

  it('renders each goal with its link and nothing when no goal applies', () => {
    const { container, rerender } = render(<MemoryRouter><WithinReach summary={base} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Within reach' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pair ordering/ })).toHaveAttribute('href', '/problems/pair_ord');
    rerender(<MemoryRouter><WithinReach summary={{ ...base, collections: [], levelUp: null, solvedToday: true }} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
