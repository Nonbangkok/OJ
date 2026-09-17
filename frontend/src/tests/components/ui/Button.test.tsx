import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../../../components/ui';

describe('Button', () => {
  it('forwards native button props and defaults to a non-submitting button', () => {
    const onClick = jest.fn();

    render(
      <Button aria-label="Save draft" data-testid="save-button" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save draft' });
    fireEvent.click(button);

    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-testid', 'save-button');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each(['primary', 'secondary', 'neutral', 'destructive'] as const)(
    'renders the %s visual variant',
    variant => {
      render(<Button variant={variant}>{variant}</Button>);

      expect(screen.getByRole('button', { name: variant })).toHaveClass(variant);
    },
  );

  it('renders compact sizing without changing its native role', () => {
    render(<Button size="compact">Add</Button>);

    expect(screen.getByRole('button', { name: 'Add' })).toHaveClass('compact');
  });

  it('announces a loading label and disables interaction while loading', () => {
    render(
      <Button variant="destructive" loading>
        Delete testcase
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Deleting…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('prefers an explicit loading label over the derived action label', () => {
    render(
      <Button loading loadingLabel="Verifying testcase…">
        Delete testcase
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Verifying testcase…' })).toBeDisabled();
  });

  it('falls back to the generic loading label for non-text children', () => {
    render(
      <Button loading>
        <em>Styled</em>
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('describes a disabled action without adding a redundant tab stop', () => {
    render(
      <Button disabled disabledReason="Build the PDF first">
        Publish
      </Button>,
    );

    const reason = screen.getByText('Build the PDF first');
    expect(reason).toHaveAttribute('id');
    expect(reason).not.toHaveAttribute('tabindex');
    reason.focus();
    expect(reason).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveAttribute(
      'aria-describedby',
      reason.id,
    );
  });
});
