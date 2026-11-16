import { Menu } from '@base-ui/react/menu';
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
  /** Custom visible trigger content (e.g. a filter chip); `label` stays the accessible name. */
  triggerContent?: React.ReactNode;
  triggerClassName?: string;
}

/** Distance kept between the menu and the viewport edges (px). */
export const MENU_VIEWPORT_MARGIN = 8;
/** Gap between the trigger and the menu (px). */
export const MENU_TRIGGER_GAP = 4;

/**
 * Overflow menu on Base UI Menu: a real button trigger, arrow-key and
 * typeahead navigation, focus moves into the menu and back to the trigger,
 * Escape and outside press close it. The popup is portaled to the body and
 * placed by Base UI's positioner (flips and shifts to stay on screen), so
 * table containers with overflow clipping never clip it.
 */
export function ActionMenu({ label, items, trigger = 'ellipsis', triggerContent, triggerClassName }: ActionMenuProps) {
  return (
    <Menu.Root modal={false}>
      {/* The wrapper keeps the trigger's box (inline-block) as callers' layouts expect. */}
      <div className={styles.root}>
        <Menu.Trigger
          className={triggerClassName ?? `${styles.trigger}${trigger === 'text' ? ` ${styles.triggerText}` : ''}`}
          aria-label={label}
          title={label}
        >
          {triggerContent ?? (trigger === 'ellipsis' ? '⋯' : 'More')}
        </Menu.Trigger>
      </div>
      <Menu.Portal>
        <Menu.Positioner
          className={styles.positioner}
          side="bottom"
          align="start"
          sideOffset={MENU_TRIGGER_GAP}
          collisionPadding={MENU_VIEWPORT_MARGIN}
        >
          <Menu.Popup className={styles.menu} aria-label={label}>
            {items.map((item) => (
              <Menu.Item
                key={item.key}
                className={`${styles.item}${item.variant === 'danger' ? ` ${styles.itemDanger}` : ''}`}
                disabled={item.disabled}
                title={item.title}
                label={item.label}
                onClick={item.onClick}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
