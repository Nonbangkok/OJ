import { useEffect, useId, useRef, useState } from 'react';
import type React from 'react';
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

/**
 * Keyboard-accessible overflow menu: a real button trigger, menu items as
 * real buttons, Escape/outside-click closes, focus returns to the trigger.
 */
export function ActionMenu({ label, items, trigger = 'ellipsis' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

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
      {open && (
        <div id={menuId} role="menu" className={styles.menu}>
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
        </div>
      )}
    </div>
  );
}
