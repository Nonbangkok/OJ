import { useEffect, useId, useRef } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from './Drawer.module.css';
import { getFocusableElements, wrapTabFocus } from './focusTrap';

export interface DrawerProps {
  open: boolean;
  title: string;
  side?: 'right' | 'left';
  children: React.ReactNode;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function Drawer({
  open,
  title,
  side = 'right',
  children,
  onClose,
  initialFocusRef,
}: DrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusRefRef = useRef(initialFocusRef);

  onCloseRef.current = onClose;
  initialFocusRefRef.current = initialFocusRef;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const drawer = drawerRef.current;

    document.body.style.overflow = 'hidden';

    const initialTarget = initialFocusRefRef.current?.current;
    const fallbackTarget = drawer ? getFocusableElements(drawer)[0] : undefined;
    (initialTarget ?? fallbackTarget ?? drawer)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (drawer) {
        wrapTabFocus(event, drawer);
      }
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
    <div
      className={`${styles.backdrop} ${styles[side]}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={drawerRef}
        className={`${styles.drawer} ${styles[side]} ${styles.motionSafe}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
            aria-label="Close drawer"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
