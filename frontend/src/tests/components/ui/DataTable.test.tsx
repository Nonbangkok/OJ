import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../components/ui';

interface Row { id: string; title: string; difficulty: number }
const rows: Row[] = [
  { id: 'a', title: 'Alpha', difficulty: 900 },
  { id: 'b', title: 'Beta', difficulty: 1200 },
];
const columns: DataTableColumn<Row>[] = [
  { key: 'id', header: 'ID', cell: (r) => r.id, mobile: 'meta' },
  { key: 'title', header: 'Title', cell: (r) => r.title, mobile: 'primary', sortable: true },
  { key: 'difficulty', header: 'Difficulty', cell: (r) => r.difficulty, align: 'right', mobile: 'meta' },
];

const setPhone = (phone: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: phone && query.includes('max-width'), media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderTable = (props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) =>
  render(<MemoryRouter><DataTable<Row> columns={columns} rows={rows} rowKey={(r) => r.id} caption="Problems" {...props} /></MemoryRouter>);

describe('DataTable', () => {
  beforeEach(() => setPhone(false));

  it('names the table and aligns numeric columns right', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'Problems' });
    const header = within(table).getByRole('columnheader', { name: 'Difficulty' });
    expect(header).toHaveAttribute('data-align', 'right');
    expect(within(table).getByRole('cell', { name: '1200' })).toHaveAttribute('data-align', 'right');
  });

  it('sorts through header buttons with aria-sort', () => {
    const onChange = jest.fn();
    renderTable({ sort: { key: 'title', direction: 'asc', onChange } });
    expect(screen.getByRole('columnheader', { name: /title/i })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: /title/i }));
    expect(onChange).toHaveBeenCalledWith('title');
  });

  it('selects rows and all rows, with an indeterminate header', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <MemoryRouter><DataTable<Row> columns={columns} rows={rows} rowKey={(r) => r.id} caption="Problems" selection={{ selected: new Set(['a']), onChange }} /></MemoryRouter>,
    );
    const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['a', 'b']));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set(['a', 'b']));
    rerender(<MemoryRouter><DataTable<Row> columns={columns} rows={rows} rowKey={(r) => r.id} caption="Problems" selection={{ selected: new Set(['a', 'b']), onChange }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set());
  });

  it('activates a row with Enter but not from a button inside it', () => {
    const onRowClick = jest.fn();
    renderTable({
      onRowClick,
      rowActions: () => [{ key: 'del', label: 'Delete', onClick: jest.fn(), variant: 'danger' }],
    });
    const row = screen.getByRole('row', { name: /Beta/ });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for b' }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('lists destructive row actions last', () => {
    renderTable({
      rowActions: () => [
        { key: 'del', label: 'Delete', onClick: jest.fn(), variant: 'danger' },
        { key: 'edit', label: 'Edit', onClick: jest.fn() },
      ],
    });
    fireEvent.click(screen.getAllByRole('button', { name: /actions for/i })[0]);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['Edit', 'Delete']);
  });

  it('shows loading, empty and error states', () => {
    const { rerender } = renderTable({ rows: [], loading: true });
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
    rerender(<MemoryRouter><DataTable<Row> columns={columns} rows={[]} rowKey={(r) => r.id} caption="Problems" empty={<p>No problems</p>} /></MemoryRouter>);
    expect(screen.getByText('No problems')).toBeInTheDocument();
    const onRetry = jest.fn();
    rerender(<MemoryRouter><DataTable<Row> columns={columns} rows={[]} rowKey={(r) => r.id} caption="Problems" error={{ message: 'Failed', onRetry }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('links the primary cell when rows have an href', () => {
    renderTable({ rowHref: (r) => `/problems/${r.id}` });
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/problems/a');
  });

  it('becomes a two-line list on phones', () => {
    setPhone(true);
    renderTable();
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Problems' });
    const item = within(list).getAllByRole('listitem')[1];
    expect(item).toHaveTextContent('Beta');
    expect(item).toHaveTextContent('b · 1200');
  });
});
