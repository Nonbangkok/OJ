import { act, fireEvent, render, screen } from '@testing-library/react';
import ConfirmationModal from '../../../features/admin/shared/ConfirmationModal';

describe('ConfirmationModal', () => {
  it('focuses the safe action and uses the destructive Button variant', () => {
    render(
      <ConfirmationModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Confirm Deletion"
        message="Are you sure you want to delete this item?"
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('destructive');
  });

  it('prevents duplicate confirmation while an async action is pending', async () => {
    let resolveConfirmation: (() => void) | undefined;
    const confirmation = new Promise<void>((resolve) => {
      resolveConfirmation = resolve;
    });
    const onConfirm = jest.fn(() => confirmation);

    render(
      <ConfirmationModal
        isOpen
        onClose={jest.fn()}
        onConfirm={onConfirm}
        title="Confirm Deletion"
        message="Are you sure you want to delete this item?"
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await act(async () => {
      resolveConfirmation?.();
      await confirmation;
    });

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});
