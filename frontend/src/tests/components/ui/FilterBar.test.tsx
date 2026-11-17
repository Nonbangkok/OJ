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
    expect(within(sheet).getByRole('button', { name: 'DP' })).toBeInTheDocument();
  });

  it('sets an unset filter from inline options in the phone sheet', () => {
    setPhone(true);
    const onChange = jest.fn();
    render(<FilterBar filters={chips(undefined, onChange)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters · 0' }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Hard' }));
    expect(onChange).toHaveBeenCalledWith('hard');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  describe('multi-select chip', () => {
    const multi = (values: string[], onChange = jest.fn()): FilterChip[] => [{
      key: 'category', label: 'Category', multiple: true, values,
      options: [{ value: 'dp', label: 'DP' }, { value: 'graph', label: 'Graph' }], onChange,
    }];

    it('ticks options in a menu that stays open, adding to the current selection', () => {
      const onChange = jest.fn();
      render(<FilterBar filters={multi(['dp'], onChange)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Edit filter Category: DP' }));
      const menu = screen.getByRole('menu');
      expect(within(menu).getByRole('menuitemcheckbox', { name: 'DP' })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Graph' }));
      expect(onChange).toHaveBeenLastCalledWith(['dp', 'graph']);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'DP' }));
      expect(onChange).toHaveBeenLastCalledWith([]);
    });

    it('an empty selection reads as an unset filter; a set one has its own remove button', () => {
      const onChange = jest.fn();
      const { rerender } = render(<FilterBar filters={multi([], onChange)} />);
      expect(screen.getByRole('button', { name: 'Add filter: Category' })).toBeInTheDocument();
      rerender(<FilterBar filters={multi(['dp', 'graph'], onChange)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Remove filter Category: DP, Graph' }));
      expect(onChange).toHaveBeenCalledWith([]);
    });

    it('toggles options in the phone sheet', () => {
      setPhone(true);
      const onChange = jest.fn();
      render(<FilterBar filters={multi(['dp'], onChange)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Filters · 1' }));
      const sheet = screen.getByRole('dialog', { name: 'Filters' });
      expect(within(sheet).getByRole('button', { name: 'DP' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Graph' }));
      expect(onChange).toHaveBeenCalledWith(['dp', 'graph']);
    });
  });
});
