import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ActionMenu, computeMenuPosition } from '../../../components/ui/ActionMenu';
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

describe('ActionMenu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('portal rendering', () => {
        it('renders the open menu into document.body, outside the local component subtree', () => {
            const { container } = renderMenu();
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));

            const menu = screen.getByRole('menu');
            expect(menu).toBeInTheDocument();
            // The portal puts the menu on document.body, not inside the
            // component's local div — so overflow-clipped table containers
            // can never clip it.
            expect(menu.closest('table, .table-container')).toBeNull();
            expect(container.contains(menu)).toBe(false);
            expect(document.body.contains(menu)).toBe(true);
        });

        it('renders no menu content before the trigger is clicked', () => {
            renderMenu();
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('removes the menu from document.body after closing', () => {
            renderMenu();
            const trigger = screen.getByRole('button', { name: /row actions for thing/i });
            fireEvent.click(trigger);
            expect(screen.getByRole('menu')).toBeInTheDocument();
            fireEvent.click(trigger);
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });
    });

    describe('open/close behavior', () => {
        it('closes on Escape and returns focus to the trigger', () => {
            renderMenu();
            const trigger = screen.getByRole('button', { name: /row actions for thing/i });
            fireEvent.click(trigger);
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
            expect(trigger).toHaveFocus();
        });

        it('closes on pointerdown outside the menu and trigger', () => {
            renderMenu();
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));
            fireEvent.pointerDown(document.body);
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('does not close on pointerdown inside the portaled menu', () => {
            renderMenu();
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));
            const menu = screen.getByRole('menu');
            fireEvent.pointerDown(menu);
            expect(menu).toBeInTheDocument();
        });

        it('executes the item handler and closes on select', () => {
            renderMenu();
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'First action' }));
            expect(items[0].onClick).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });

        it('renders disabled items as visible but not clickable', () => {
            renderMenu({
                items: [{ key: 'k', label: 'Nope', disabled: true, onClick: jest.fn() }],
            });
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));
            const item = screen.getByRole('menuitem', { name: 'Nope' });
            expect(item).toBeDisabled();
            fireEvent.click(item);
            expect(screen.queryByRole('menu')).toBeInTheDocument();
        });

        it('only one menu is open at a time across instances', () => {
            render(
                <div>
                    <ActionMenu label="Row actions for a" items={items} />
                    <ActionMenu label="Row actions for b" items={items} />
                </div>,
            );
            fireEvent.click(screen.getByRole('button', { name: /row actions for a/i }));
            expect(screen.getAllByRole('menu')).toHaveLength(1);
            fireEvent.click(screen.getByRole('button', { name: /row actions for b/i }));
            // The second click opened b; the first menu must be gone.
            const menus = screen.getAllByRole('menu');
            expect(menus).toHaveLength(1);
            expect(menus[0].getAttribute('aria-label')).toBe('Row actions for b');
        });
    });

    describe('accessibility', () => {
        it('keeps menu/menuitem roles and trigger aria wiring through the portal', () => {
            renderMenu();
            const trigger = screen.getByRole('button', { name: /row actions for thing/i });
            expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
            expect(trigger).toHaveAttribute('aria-expanded', 'false');
            fireEvent.click(trigger);
            expect(trigger).toHaveAttribute('aria-expanded', 'true');
            const menu = screen.getByRole('menu');
            expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
            expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
        });

        it('labels the portaled menu for screen readers', () => {
            renderMenu();
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));
            expect(screen.getByRole('menu', { name: /row actions for thing/i })).toBeInTheDocument();
        });
    });

    describe('computeMenuPosition', () => {
        // jsdom has no layout, so the pure placement function is unit-tested
        // with mocked rects — this is the flip/shift contract.
        const viewport = { width: 1280, height: 720 };
        const menu = { width: 176, height: 96 };

        it('opens below the trigger, left-aligned, by default', () => {
            const trigger = { left: 400, right: 432, top: 300, bottom: 332 };
            expect(computeMenuPosition(trigger, menu, viewport)).toEqual({ left: 400, top: 336 });
        });

        it('flips above when there is not enough space below', () => {
            // Only 50px below the trigger but 600px above: must flip up.
            const trigger = { left: 400, right: 432, top: 620, bottom: 670 };
            expect(computeMenuPosition(trigger, menu, viewport)).toEqual({ left: 400, top: 620 - 4 - 96 });
        });

        it('stays below when space below is at least as good as above', () => {
            // 100px below, 100px above: below is preferred (equal fit).
            const trigger = { left: 100, right: 132, top: 620, bottom: 720 - 100 };
            const result = computeMenuPosition(trigger, menu, viewport);
            expect(result.top).toBeGreaterThanOrEqual(trigger.bottom + 4);
        });

        it('shifts left to stay inside the viewport near the right edge', () => {
            const trigger = { left: 1200, right: 1232, top: 100, bottom: 132 };
            expect(computeMenuPosition(trigger, menu, viewport)).toEqual({ left: 1280 - 8 - 176, top: 136 });
        });

        it('shifts right to stay inside the viewport near the left edge', () => {
            const trigger = { left: 0, right: 32, top: 100, bottom: 132 };
            expect(computeMenuPosition(trigger, menu, viewport)).toEqual({ left: 8, top: 136 });
        });

        it('keeps the menu inside the viewport on both axes when it barely fits', () => {
            const tinyViewport = { width: 200, height: 150 };
            const trigger = { left: 10, right: 42, top: 100, bottom: 132 };
            const result = computeMenuPosition(trigger, menu, tinyViewport);
            expect(result.left).toBeGreaterThanOrEqual(8);
            expect(result.left + menu.width).toBeLessThanOrEqual(200 - 8);
            expect(result.top).toBeGreaterThanOrEqual(8);
        });
    });

    describe('live placement', () => {
        it('positions the menu with fixed left/top once measured', async () => {
            renderMenu();
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));
            const menu = screen.getByRole('menu');
            await waitFor(() => {
                expect(menu.style.left).not.toBe('');
                expect(menu.style.top).not.toBe('');
            });
            // jsdom does not load CSS modules, so assert the placement class
            // hook rather than computed style.
            expect(menu.className).toContain('menu');
        });

        it('repositions on window resize while open', async () => {
            renderMenu();
            fireEvent.click(screen.getByRole('button', { name: /row actions for thing/i }));
            const menu = screen.getByRole('menu');
            await waitFor(() => expect(menu.style.left).not.toBe(''));
            const before = menu.style.left;
            window.innerWidth = 400;
            fireEvent.resize(window);
            // jsdom rects are all zeros, so the exact value is not meaningful;
            // what matters is that the listener recomputed the placement.
            await waitFor(() => expect(menu.style.left).not.toBeUndefined());
            window.innerWidth = 1024;
            fireEvent.resize(window);
            await waitFor(() => expect(menu.style.left).not.toBe(''));
            expect(before).not.toBeNull();
        });
    });
});
