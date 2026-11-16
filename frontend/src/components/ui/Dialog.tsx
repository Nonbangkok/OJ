import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type React from 'react';
import { Button } from './Button';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
  /** Renders a wider, taller variant for content-heavy dialogs (help, galleries). */
  wide?: boolean;
  /** Near-viewport sizing for full workspaces (code + results). The dialog
   *  still respects the backdrop padding so it never touches the edges. */
  size?: 'default' | 'fullscreen';
}

/**
 * Modal dialog on Base UI: focus trap, Escape and outside-press dismissal,
 * scroll lock and focus return come from Base UI; this component keeps the
 * app's props and look.
 */
export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  initialFocusRef,
  closeOnEscape = true,
  wide = false,
  size = 'default',
}: DialogProps) {
  const popupClass = [
    styles.dialog,
    wide ? styles.dialogWide : '',
    size === 'fullscreen' ? styles.dialogFullscreen : '',
  ].filter(Boolean).join(' ');

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === 'escape-key' && !closeOnEscape) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Viewport className={styles.viewport}>
          <BaseDialog.Popup
            className={popupClass}
            aria-modal="true"
            initialFocus={initialFocusRef ?? true}
          >
            <div className={styles.header}>
              <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
              <BaseDialog.Close
                render={<Button className={styles.closeButton} variant="neutral" size="compact" />}
                aria-label="Close dialog"
              >
                <span aria-hidden="true">×</span>
              </BaseDialog.Close>
            </div>
            {description && <BaseDialog.Description className={styles.description}>{description}</BaseDialog.Description>}
            {children && <div className={styles.body}>{children}</div>}
            {footer && <div className={styles.footer}>{footer}</div>}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
