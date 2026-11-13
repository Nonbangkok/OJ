import { useEffect, useLayoutEffect, useRef } from 'react';
import type React from 'react';
import { getFocusableElements, wrapTabFocus } from './focusTrap';

export interface ModalFocusOptions {
  open: boolean;
  onClose: () => void;
  /** Escape calls onClose unless this is false (e.g. while an upload runs). */
  closeOnEscape?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Modal keyboard behaviour shared by Dialog and the older form modals: while
 * open, focus moves into the dialog, Tab stays inside it, Escape closes it,
 * page scroll is locked, and focus returns to the opener on close.
 *
 * An Escape that something inside the dialog already handled (e.g. a date
 * picker closing its calendar calls preventDefault) does not close it.
 */
export function useModalFocus(
  dialogRef: React.RefObject<HTMLElement | null>,
  { open, onClose, closeOnEscape = true, initialFocusRef }: ModalFocusOptions,
): void {
  const onCloseRef = useRef(onClose);
  const initialFocusRefRef = useRef(initialFocusRef);
  const closeOnEscapeRef = useRef(closeOnEscape);

  // Latest-value refs, refreshed after every commit and before the passive
  // open effect below runs, so it and its keydown handler see current props
  // without re-running the focus/scroll-lock setup on every render.
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    initialFocusRefRef.current = initialFocusRef;
    closeOnEscapeRef.current = closeOnEscape;
  });

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
      if (event.key === 'Escape') {
        if (event.defaultPrevented || !closeOnEscapeRef.current) return;
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
  }, [open, dialogRef]);
}
