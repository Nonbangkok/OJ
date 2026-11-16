import { fireEvent, render, screen } from '@testing-library/react';
import { EmptyState, InlineError, InlineNotice } from '../../../components/ui';

describe('states', () => {
  it('EmptyState shows title, description and action', () => {
    render(<EmptyState title="No contests yet" description="Check back later." action={<button type="button">Create</button>} />);
    expect(screen.getByText('No contests yet')).toBeInTheDocument();
    expect(screen.getByText('Check back later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('InlineError announces itself and can retry', () => {
    const onRetry = jest.fn();
    render(<InlineError message="Could not load problems." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load problems.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('InlineError without retry has no button', () => {
    render(<InlineError message="Nope" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['neutral', 'warning', 'danger', 'success'] as const)('InlineNotice %s renders its content with an icon', (tone) => {
    const { container } = render(<InlineNotice tone={tone} title="Heads up">Body text</InlineNotice>);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstChild).toHaveAttribute('data-tone', tone);
  });
});
