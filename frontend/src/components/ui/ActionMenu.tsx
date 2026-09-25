import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import styles from './ActionMenu.module.css';

export interface ActionMenuItem {
  /** Stable key for list rendering. */
  key: string;
  /** Visible label. */
  label: string;
  onClick: () => void;
  /** Visual variant: 'danger' renders destructive styling. */
  variant?: 'default' | 'danger';
  /** Disables the item while keeping it visible. */
  disabled?: boolean;
  /** Optional tooltip shown on hover. */
  title?: string;
}

export interface ActionMenuProps {
  /** Accessible name for the trigger button (e.g. "Row actions for X"). */
  label: string;
  items: ActionMenuItem[];
  /** Visual style of the trigger. */
  trigger?: 'ellipsis' | 'text';
}

/** Distance kept between the menu and the viewport edges (px). */
export const MENU_VIEWPORT_MARGIN = 8;
/** Gap between the trigger and the menu (px). */
export const MENU_TRIGGER_GAP = 4;

export interface MenuPosition {
  /** Left edge of the menu in viewport (fixed-position) coordinates. */
  left: number;
  /** Top edge of the menu in viewport (fixed-position) coordinates. */
  top: number;
}

/**
 * Pure rect-based placement for the portal menu. Default: below the trigger,
 * left-aligned with it. Flips above the trigger when the menu does not fit
 * between the trigger's bottom edge and the viewport bottom; shifts
 * horizontally to keep the menu inside the viewport with a small margin.
 * Exported for unit testing with mocked rects.
 */
export function computeMenuPosition(
  triggerRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPosition {
  const margin = MENU_VIEWPORT_MARGIN;
  const gap = MENU_TRIGGER_GAP;

  // Vertical: prefer below; flip above only when below cannot fit the menu
  // and above can do better. Never overlaps the trigger when either side fits.
  const spaceBelow = viewport.height - triggerRect.bottom - gap;
  const spaceAbove = triggerRect.top - gap;
  const openBelow = spaceBelow >= menuSize.height || spaceBelow >= spaceAbove;
  let top: number;
  if (openBelow) {
    top = triggerRect.bottom + gap;
    // Only when the menu cannot fit on either side do we clamp it into the
    // viewport (taller menu than viewport); margin wins over the trigger gap.
    if (top + menuSize.height > viewport.height) {
      top = Math.max(viewport.height - margin - menuSize.height, margin);
    }
  } else {
    top = Math.max(triggerRect.top - gap - menuSize.height, margin);
  }

  // Horizontal: left-align with the trigger, then clamp into the viewport.
  let left = triggerRect.left;
  if (left + menuSize.width > viewport.width - margin) {
    left = viewport.width - margin - menuSize.width;
  }
  if (left < margin) {
    left = margin;
  }

  return { left, top };
}

/**
 * Only one ActionMenu may be open at a time across the whole app: opening a
 * menu closes whichever was open before (e.g. another table row's menu).
 */
let closeOpenMenu: (() => void) | null = null;

/**
 * Keyboard-accessible overflow menu: a real button trigger, menu items as
 * real buttons, Escape/outside-click closes, focus returns to the trigger.
 *
 * The open menu renders through a portal to document.body as a
 * position:fixed overlay, so ancestors with overflow clipping (the shared
 * table container) can never clip it, and opening it never affects table
 * layout. Placement is recomputed on resize/scroll while open.
 */
export function ActionMenu({ label, items, trigger = 'ellipsis' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuId = useId();

  // Register as the single open menu while open; opening another instance
  // closes this one via the module-level slot.
  useEffect(() => {
    if (!open) return;
    closeOpenMenu?.();
    const close = () => setOpen(false);
    closeOpenMenu = close;
    return () => {
      // Only clear the slot if this instance still owns it (another menu
      // may have taken over during the same commit).
      if (closeOpenMenu === close) {
        closeOpenMenu = null;
      }
    };
  }, [open]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) {
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setPosition(
      computeMenuPosition(
        triggerRect,
        { width: menuRect.width, height: menuRect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  // Measure and place the menu before paint so it never flashes at (0, 0).
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The menu itself lives in a portal; both it and the local root count
      // as "inside" so a click on the trigger toggles instead of closing.
      if (
        rootRef.current?.contains(target) ||
        (menuRef.current && menuRef.current.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    // capture phase: reposition before paint on any scroll (table containers
    // scroll internally, so this must be window-wide, not per-element).
    const onReposition = () => updatePosition();

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updatePosition]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger}${trigger === 'text' ? ` ${styles.triggerText}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((previous) => !previous)}
      >
        {trigger === 'ellipsis' ? '⋯' : 'More'}
      </button>
      {open &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label={label}
            className={styles.menu}
            style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`${styles.item}${item.variant === 'danger' ? ` ${styles.itemDanger}` : ''}`}
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
