import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type React from 'react';
import { Button } from './Button';
import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  title: string;
  side?: 'right' | 'left';
  children: React.ReactNode;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/** Side sheet: a Base UI modal dialog anchored to the left or right edge. */
export function Drawer({
  open,
  title,
  side = 'right',
  children,
  onClose,
  initialFocusRef,
}: DrawerProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Viewport className={`${styles.viewport} ${styles[side]}`}>
          <BaseDialog.Popup
            className={`${styles.drawer} ${styles[side]} ${styles.motionSafe}`}
            aria-modal="true"
            initialFocus={initialFocusRef ?? true}
          >
            <div className={styles.header}>
              <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
              <BaseDialog.Close
                render={<Button className={styles.closeButton} variant="neutral" size="compact" />}
                aria-label="Close drawer"
              >
                <span aria-hidden="true">×</span>
              </BaseDialog.Close>
            </div>
            <div className={styles.body}>{children}</div>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
