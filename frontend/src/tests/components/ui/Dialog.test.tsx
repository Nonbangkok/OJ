import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { Dialog } from '../../../components/ui/Dialog';

describe('Dialog', () => {
  it('renders a body portal with labelled modal dialog semantics', () => {
    render(
      <Dialog
        open
        title="Delete account"
        description="This action cannot be undone."
        onClose={jest.fn()}
      >
        <p>Dialog body</p>
      </Dialog>
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete account' });
    const title = screen.getByRole('heading', { name: 'Delete account' });
    const description = screen.getByText('This action cannot be undone.');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(dialog).toHaveAttribute('aria-describedby', description.id);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('focuses the supplied initial focus target', () => {
    const initialFocusRef = createRef<HTMLButtonElement>();

    render(
      <Dialog open title="Choose an action" onClose={jest.fn()} initialFocusRef={initialFocusRef}>
        <button>First action</button>
        <button ref={initialFocusRef}>Safe action</button>
      </Dialog>
    );

    expect(screen.getByRole('button', { name: 'Safe action' })).toHaveFocus();
  });

  it('focuses the first focusable element when no initial target is supplied', () => {
    render(
      <Dialog open title="Choose an action" onClose={jest.fn()}>
        <button>Continue</button>
      </Dialog>
    );

    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('wraps Tab and Shift+Tab within the dialog', () => {
    render(
      <Dialog open title="Choose an action" onClose={jest.fn()}>
        <button>Continue</button>
      </Dialog>
    );

    const closeButton = screen.getByRole('button', { name: 'Close dialog' });
    const continueButton = screen.getByRole('button', { name: 'Continue' });

    continueButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(continueButton).toHaveFocus();
  });

  it('returns forward Tab to the first dialog control when focus is outside', () => {
    render(
      <>
        <button>Outside action</button>
        <Dialog open title="Contained dialog" onClose={jest.fn()}>
          <button>Continue</button>
        </Dialog>
      </>
    );

    screen.getByRole('button', { name: 'Outside action' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('returns Shift+Tab to the last dialog control when focus is outside', () => {
    render(
      <>
        <button>Outside action</button>
        <Dialog open title="Contained dialog" onClose={jest.fn()}>
          <button>Continue</button>
        </Dialog>
      </>
    );

    screen.getByRole('button', { name: 'Outside action' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
  });

  it('closes on Escape unless Escape closing is disabled', () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <Dialog open title="Closable dialog" onClose={onClose}>
        <button>Continue</button>
      </Dialog>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Dialog open title="Fixed dialog" onClose={onClose} closeOnEscape={false}>
        <button>Continue</button>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from a backdrop click but not from a click inside the surface', () => {
    const onClose = jest.fn();
    render(
      <Dialog open title="Clickable dialog" onClose={onClose}>
        <button>Continue</button>
      </Dialog>
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves and restores body overflow while open', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(<Dialog open title="Locked dialog" onClose={jest.fn()} />);

    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Dialog open={false} title="Locked dialog" onClose={jest.fn()} />);

    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('restores focus to the opener after closing', () => {
    function Harness() {
      const [open, setOpen] = useState(false);

      return (
        <>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          <Dialog open={open} title="Restorable dialog" onClose={() => setOpen(false)}>
            <button>Continue</button>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    expect(opener).toHaveFocus();
  });
});
