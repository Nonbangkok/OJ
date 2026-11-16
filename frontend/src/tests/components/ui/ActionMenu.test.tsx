import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionMenu } from '../../../components/ui/ActionMenu';
import type { ActionMenuItem } from '../../../components/ui/ActionMenu';

const items: ActionMenuItem[] = [
    { key: 'first', label: 'First action', onClick: jest.fn() },
    { key: 'delete', label: 'Delete', variant: 'danger', onClick: jest.fn() },
];

function renderMenu(props: Partial<Parameters<typeof ActionMenu>[0]> = {}) {
    return render(
        <ActionMenu label="Row actions for thing" items={items} {...props} />,
    );
}

// Base UI ignores a trigger press whose release lands in the same instant
// (it reads that as a drag-to-select); a 20ms gap is a human-speed click.
const setupUser = () => userEvent.setup({ delay: 20 });

const trigger = () => screen.getByRole('button', { name: /row actions for thing/i });

describe('ActionMenu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('portal rendering', () => {
        it('renders the open menu into document.body, outside the local component subtree', () => {
            const { container } = renderMenu();
            fireEvent.click(trigger());

            const menu = screen.getByRole('menu');
            // The portal puts the menu on document.body, not inside the
            // component's local subtree — so overflow-clipped table containers
            // can never clip it.
            expect(menu.closest('table, .table-container')).toBeNull();
            expect(container.contains(menu)).toBe(false);
            expect(document.body.contains(menu)).toBe(true);
        });

        it('renders no menu content before the trigger is clicked', () => {
            renderMenu();
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('removes the menu after the trigger is clicked again', async () => {
            renderMenu();
            fireEvent.click(trigger());
            expect(screen.getByRole('menu')).toBeInTheDocument();
            fireEvent.click(trigger());
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        });
    });

    describe('open/close behavior', () => {
        it('closes on Escape and returns focus to the trigger', async () => {
            const user = setupUser();
            renderMenu();
            await user.click(trigger());
            await user.keyboard('{Escape}');
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
            expect(trigger()).toHaveFocus();
        });

        it('closes on a press outside the menu and trigger', async () => {
            const user = setupUser();
            render(
                <>
                    <button>Elsewhere</button>
                    <ActionMenu label="Row actions for thing" items={items} />
                </>,
            );
            await user.click(trigger());
            await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        });

        it('does not close on a press inside the menu that misses every item', async () => {
            const user = setupUser();
            renderMenu();
            await user.click(trigger());
            await user.click(screen.getByRole('menu'));
            expect(screen.getByRole('menu')).toBeInTheDocument();
        });

        it('executes the item handler and closes on select', async () => {
            renderMenu();
            fireEvent.click(trigger());
            fireEvent.click(screen.getByRole('menuitem', { name: 'First action' }));
            expect(items[0].onClick).toHaveBeenCalledTimes(1);
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        });

        it('renders disabled items as visible but not clickable', () => {
            const onClick = jest.fn();
            renderMenu({ items: [{ key: 'k', label: 'Nope', disabled: true, onClick }] });
            fireEvent.click(trigger());
            const item = screen.getByRole('menuitem', { name: 'Nope' });
            expect(item).toHaveAttribute('aria-disabled', 'true');
            fireEvent.click(item);
            expect(onClick).not.toHaveBeenCalled();
            expect(screen.getByRole('menu')).toBeInTheDocument();
        });

        it('only one menu is open at a time across instances', async () => {
            const user = setupUser();
            render(
                <div>
                    <ActionMenu label="Row actions for a" items={items} />
                    <ActionMenu label="Row actions for b" items={items} />
                </div>,
            );
            await user.click(screen.getByRole('button', { name: /row actions for a/i }));
            expect(screen.getAllByRole('menu')).toHaveLength(1);
            await user.click(screen.getByRole('button', { name: /row actions for b/i }));
            await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
            expect(screen.getByRole('menu')).toHaveAttribute('aria-label', 'Row actions for b');
        });
    });

    describe('keyboard', () => {
        it('moves focus into the menu and between items with the arrow keys', async () => {
            const user = setupUser();
            renderMenu();
            trigger().focus();
            await user.keyboard('{Enter}');
            await waitFor(() => expect(screen.getByRole('menuitem', { name: 'First action' })).toHaveFocus());
            await user.keyboard('{ArrowDown}');
            expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
            await user.keyboard('{Enter}');
            expect(items[1].onClick).toHaveBeenCalledTimes(1);
        });
    });

    describe('accessibility', () => {
        it('keeps menu/menuitem roles and trigger aria wiring through the portal', () => {
            renderMenu();
            expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
            expect(trigger()).toHaveAttribute('aria-expanded', 'false');
            fireEvent.click(trigger());
            expect(trigger()).toHaveAttribute('aria-expanded', 'true');
            const menu = screen.getByRole('menu');
            expect(trigger().getAttribute('aria-controls')).toBe(menu.id);
            expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
        });

        it('labels the portaled menu for screen readers', () => {
            renderMenu();
            fireEvent.click(trigger());
            expect(screen.getByRole('menu', { name: /row actions for thing/i })).toBeInTheDocument();
        });
    });

    describe('placement', () => {
        // jsdom has no layout; Base UI's positioner owns flip/shift. The
        // contract here is the requested placement and the fixed layer.
        it('asks for a fixed layer below the trigger, start-aligned', () => {
            renderMenu();
            fireEvent.click(trigger());
            const positioner = screen.getByRole('menu').parentElement as HTMLElement;
            expect(positioner).toHaveAttribute('data-side', 'bottom');
            expect(positioner).toHaveAttribute('data-align', 'start');
            expect(positioner.style.position).toBe('fixed');
            expect(screen.getByRole('menu').className).toContain('menu');
        });
    });
});
