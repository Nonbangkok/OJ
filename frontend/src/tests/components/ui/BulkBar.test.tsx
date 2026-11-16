import { fireEvent, render, screen, within } from '@testing-library/react';
import { BulkBar } from '../../../components/ui';

describe('BulkBar', () => {
  it('renders nothing with no selection', () => {
    const { container } = render(<BulkBar count={0} onClear={jest.fn()} actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count, three visible actions and the rest (plus destructive) in overflow', () => {
    const onClear = jest.fn();
    const del = jest.fn();
    render(
      <BulkBar
        count={2}
        onClear={onClear}
        actions={[
          { key: 'show', label: 'Show', onClick: jest.fn() },
          { key: 'delete', label: 'Delete', onClick: del, destructive: true },
          { key: 'hide', label: 'Hide', onClick: jest.fn() },
          { key: 'move', label: 'Move to…', onClick: jest.fn() },
          { key: 'export', label: 'Export', onClick: jest.fn() },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Bulk actions' });
    expect(region).toHaveTextContent('2 selected');
    expect(within(region).getAllByRole('button').map((b) => b.textContent)).toEqual(['Clear', 'Show', 'Hide', 'Move to…', '⋯']);
    fireEvent.click(within(region).getByRole('button', { name: 'More bulk actions' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['Export', 'Delete']);
    fireEvent.click(within(region).getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });
});
