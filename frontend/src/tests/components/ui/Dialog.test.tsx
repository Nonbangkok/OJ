import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(dialog.closest('[data-base-ui-portal]')?.parentElement).toBe(document.body);
  });

  it('focuses the supplied initial focus target', async () => {
    const initialFocusRef = createRef<HTMLButtonElement>();

    render(
      <Dialog open title="Choose an action" onClose={jest.fn()} initialFocusRef={initialFocusRef}>
        <button>First action</button>
        <button ref={initialFocusRef}>Safe action</button>
      </Dialog>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Safe action' })).toHaveFocus());
  });

  it('focuses the first focusable element when no initial target is supplied', async () => {
    render(
      <Dialog open title="Choose an action" onClose={jest.fn()}>
        <button>Continue</button>
      </Dialog>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus());
  });

  // Base UI traps focus with focus guards and makes the rest of the page
  // inert; jsdom cannot run the guard's redirect, so the contract checked
  // here is the inert outside content.
  it('hides and inerts content outside the dialog while open', async () => {
    const { rerender } = render(
      <>
        <button>Outside action</button>
        <Dialog open title="Contained dialog" onClose={jest.fn()}>
          <button>Continue</button>
        </Dialog>
      </>
    );

    const outside = screen.getByText('Outside action');
    expect(outside.closest('[aria-hidden="true"]')).not.toBeNull();

    rerender(
      <>
        <button>Outside action</button>
        <Dialog open={false} title="Contained dialog" onClose={jest.fn()}>
          <button>Continue</button>
        </Dialog>
      </>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Outside action' }).closest('[aria-hidden="true"]')).toBeNull());
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

  it('locks page scroll while open and releases it after closing', async () => {
    const { rerender } = render(<Dialog open title="Locked dialog" onClose={jest.fn()} />);

    await waitFor(() => expect(document.documentElement.style.overflowY).toBe('hidden'));

    rerender(<Dialog open={false} title="Locked dialog" onClose={jest.fn()} />);

    await waitFor(() => expect(document.documentElement.style.overflowY).not.toBe('hidden'));
  });

  it('restores focus to the opener after closing', async () => {
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

    await waitFor(() => expect(opener).toHaveFocus());
  });
});
