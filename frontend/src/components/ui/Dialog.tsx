import { useEffect, useId, useRef } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from './Dialog.module.css';
import { getFocusableElements, wrapTabFocus } from './focusTrap';

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
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusRefRef = useRef(initialFocusRef);
  const closeOnEscapeRef = useRef(closeOnEscape);

  onCloseRef.current = onClose;
  initialFocusRefRef.current = initialFocusRef;
  closeOnEscapeRef.current = closeOnEscape;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;

    document.body.style.overflow = 'hidden';

    const initialTarget = initialFocusRefRef.current?.current;
    const fallbackTarget = dialog ? getFocusableElements(dialog)[0] : undefined;
    (initialTarget ?? fallbackTarget ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (!dialog) {
        return;
      }

      wrapTabFocus(event, dialog);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

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
        className={`${styles.dialog}${wide ? ` ${styles.dialogWide}` : ''}`}
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
