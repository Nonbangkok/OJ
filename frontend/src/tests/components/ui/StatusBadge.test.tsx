import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../../../components/ui';

describe('StatusBadge', () => {
  it.each(['neutral', 'info', 'success', 'warning', 'danger'] as const)(
    'renders supplied content with the %s tone and forwarded span attributes',
    tone => {
      render(
        <StatusBadge tone={tone} data-testid="submission-status" title="Current submission status">
          Accepted
        </StatusBadge>,
      );

      const badge = screen.getByTestId('submission-status');
      expect(badge).toHaveTextContent('Accepted');
      expect(badge).toHaveClass(tone);
      expect(badge).toHaveAttribute('title', 'Current submission status');
    },
  );

  it('keeps its native span semantics without imposing an ARIA role', () => {
    render(<StatusBadge>Queued</StatusBadge>);

    expect(screen.getByText('Queued')).not.toHaveAttribute('role');
  });
});
