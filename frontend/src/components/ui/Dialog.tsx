import { useId, useRef } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from './Dialog.module.css';
import { useModalFocus } from './useModalFocus';

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
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, { open, onClose, closeOnEscape, initialFocusRef });

  if (!open) {
    return null;
  }

  return createPortal(
    // Backdrop click-to-dismiss is a mouse convenience; Escape and the focus
    // trap give keyboard users the same control, so the overlay stays
    // non-focusable by design.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={`${styles.dialog}${wide ? ` ${styles.dialogWide}` : ''}${size === 'fullscreen' ? ` ${styles.dialogFullscreen}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <Button
            className={styles.closeButton}
            variant="neutral"
            size="compact"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </div>
        {description && (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        )}
        {children && <div className={styles.body}>{children}</div>}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
