import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../../../components/ui';

describe('ConfirmDialog', () => {
  it('plain confirm', () => {
    const onConfirm = jest.fn();
    render(<ConfirmDialog open tier="plain" title="Hide 2 problems?" body="They can be shown again." confirmLabel="Hide problems" onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide problems' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('typed confirm needs the exact text', () => {
    const onConfirm = jest.fn();
    render(<ConfirmDialog open tier="typed" title="Delete user nattapat?" body="214 submissions will be deleted." confirmLabel="Delete user" confirmText="nattapat" onConfirm={onConfirm} onCancel={jest.fn()} />);
    const button = screen.getByRole('button', { name: 'Delete user' });
    const input = screen.getByRole('textbox', { name: /type nattapat to confirm/i });
    expect(button).toBeDisabled();
    for (const wrong of [' nattapat', 'nattapat ', 'Nattapat']) {
      fireEvent.change(input, { target: { value: wrong } });
      expect(button).toBeDisabled();
    }
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'nattapat' } });
    expect(button).toBeEnabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancel closes', () => {
    const onCancel = jest.fn();
    render(<ConfirmDialog open tier="destructive" title="Delete contest?" body="x" confirmLabel="Delete contest" onConfirm={jest.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
