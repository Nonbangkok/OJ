import { fireEvent, render, screen, within } from '@testing-library/react';
import { FilterBar, type FilterChip } from '../../../components/ui';

const setPhone = (phone: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: phone && query.includes('max-width'), media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
};

const chips = (difficulty: string | undefined, onChange = jest.fn()): FilterChip[] => [
  { key: 'difficulty', label: 'Difficulty', value: difficulty, options: [{ value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }], onChange },
  { key: 'category', label: 'Category', value: undefined, options: [{ value: 'dp', label: 'DP' }], onChange: jest.fn() },
];

describe('FilterBar', () => {
  beforeEach(() => setPhone(false));

  it('searches', () => {
    const onChange = jest.fn();
    render(<FilterBar search={{ value: '', onChange, placeholder: 'Search problems' }} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search problems' }), { target: { value: 'vec' } });
    expect(onChange).toHaveBeenCalledWith('vec');
  });

  it('sets an unset filter from its menu', () => {
    const onChange = jest.fn();
    render(<FilterBar filters={chips(undefined, onChange)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add filter: Difficulty' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Hard' }));
    expect(onChange).toHaveBeenCalledWith('hard');
  });

  it('shows a set filter as a removable chip', () => {
    const onChange = jest.fn();
    render(<FilterBar filters={chips('easy', onChange)} resultCount="12 of 146" />);
    expect(screen.getByText('12 of 146')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Difficulty: Easy' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('collapses filters behind one button on phones', () => {
    setPhone(true);
    render(<FilterBar filters={chips('easy')} />);
    expect(screen.queryByRole('button', { name: 'Add filter: Category' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filters · 1' }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(sheet).getByRole('button', { name: 'Add filter: Category' })).toBeInTheDocument();
  });
});
