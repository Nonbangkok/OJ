import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, useState } from 'react';
import { Drawer } from '../../../components/ui/Drawer';

describe('Drawer', () => {
  it('renders a body portal with labelled modal dialog semantics', () => {
    render(
      <Drawer open title="Edit filters" onClose={jest.fn()}>
        <p>Drawer body</p>
      </Drawer>
    );

    const drawer = screen.getByRole('dialog', { name: 'Edit filters' });
    const title = screen.getByRole('heading', { name: 'Edit filters' });

    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveAttribute('aria-labelledby', title.id);
    expect(drawer.closest('[data-base-ui-portal]')?.parentElement).toBe(document.body);
  });

  it('closes from its close button', () => {
    const onClose = jest.fn();
    render(
      <Drawer open title="Edit filters" onClose={onClose}>
        <button>Apply filters</button>
      </Drawer>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(
      <Drawer open title="Edit filters" onClose={onClose}>
        Drawer body
      </Drawer>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from a backdrop click but not from a click inside the surface', () => {
    const onClose = jest.fn();
    render(
      <Drawer open title="Edit filters" onClose={onClose}>
        <button>Apply filters</button>
      </Drawer>
    );

    const drawer = screen.getByRole('dialog');
    fireEvent.click(drawer);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(drawer.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the supplied initial focus target', async () => {
    const initialFocusRef = createRef<HTMLButtonElement>();
    render(
      <Drawer open title="Edit filters" onClose={jest.fn()} initialFocusRef={initialFocusRef}>
        <button>Clear filters</button>
        <button ref={initialFocusRef}>Apply filters</button>
      </Drawer>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveFocus());
  });

  it('focuses the first focusable element when no initial target is supplied', async () => {
    render(
      <Drawer open title="Edit filters" onClose={jest.fn()}>
        <button>Apply filters</button>
      </Drawer>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close drawer' })).toHaveFocus());
  });

  it('hides and inerts content outside the drawer while open', () => {
    render(
      <>
        <button>Outside action</button>
        <Drawer open title="Edit filters" onClose={jest.fn()}>
          <button>Apply filters</button>
        </Drawer>
      </>
    );

    expect(screen.getByText('Outside action').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('restores focus to the opener and releases the scroll lock after closing', async () => {

    function Harness() {
      const [open, setOpen] = useState(false);

      return (
        <>
          <button onClick={() => setOpen(true)}>Open filters</button>
          <Drawer open={open} title="Edit filters" onClose={() => setOpen(false)}>
            <button>Apply filters</button>
          </Drawer>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open filters' });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.documentElement.style.overflowY).toBe('hidden'));

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));

    await waitFor(() => expect(opener).toHaveFocus());
    await waitFor(() => expect(document.documentElement.style.overflowY).not.toBe('hidden'));
  });

  it('defaults to the right side and supports a left-side surface', () => {
    const { rerender } = render(
      <Drawer open title="Right drawer" onClose={jest.fn()}>
        Drawer body
      </Drawer>
    );

    expect(screen.getByRole('dialog')).toHaveClass('right');

    rerender(
      <Drawer open title="Left drawer" side="left" onClose={jest.fn()}>
        Drawer body
      </Drawer>
    );

    expect(screen.getByRole('dialog')).toHaveClass('left');
  });

  it('applies the transition class whose motion is gated by the user preference', () => {
    render(
      <Drawer open title="Animated drawer" onClose={jest.fn()}>
        Drawer body
      </Drawer>
    );

    expect(screen.getByRole('dialog')).toHaveClass('motionSafe');
  });
});
