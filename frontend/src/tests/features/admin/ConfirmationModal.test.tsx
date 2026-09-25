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

  it('blocks every dismissal path while confirmation is pending and restores closing afterward', async () => {
    let resolveConfirmation: (() => void) | undefined;
    const confirmation = new Promise<void>((resolve) => {
      resolveConfirmation = resolve;
    });
    const onClose = jest.fn();

    render(
      <ConfirmationModal
        isOpen
        onClose={onClose}
        onConfirm={() => confirmation}
        title="Confirm Deletion"
        message="Are you sure you want to delete this item?"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveConfirmation?.();
      await confirmation;
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires the exact confirmation phrase before enabling the confirm button', async () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        onClose={jest.fn()}
        onConfirm={onConfirm}
        title="Import database?"
        message="This will permanently replace all existing database data."
        confirmText="Import Database"
        confirmationPhrase="IMPORT"
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Import Database' });
    const phraseInput = screen.getByLabelText('Type IMPORT to confirm');

    // Confirm starts disabled; typing the wrong phrase keeps it disabled.
    expect(confirmButton).toBeDisabled();
    fireEvent.change(phraseInput, { target: { value: 'import' } });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();

    // The exact phrase unlocks it.
    fireEvent.change(phraseInput, { target: { value: 'IMPORT' } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
