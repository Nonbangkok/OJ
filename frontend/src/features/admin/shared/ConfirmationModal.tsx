import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Button, Dialog, Field, Input } from '../../../components/ui';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  confirmStyle?: 'danger' | 'default';
  objectName?: string;
  /** Extra content rendered between the message and the footer (e.g. the
   *  selected-file label for database imports). */
  children?: React.ReactNode;
  /** When set, the confirm button stays disabled until the user types this
   *  exact phrase into the confirmation input (type-to-confirm guard for
   *  highly destructive actions). */
  confirmationPhrase?: string;
}

const ConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  confirmStyle = 'danger',
  children,
  confirmationPhrase,
}: ConfirmationModalProps) => {
  const cancelRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const [isPending, setIsPending] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const requiresPhrase = Boolean(confirmationPhrase);
  const phraseMatches = !requiresPhrase || phraseInput === confirmationPhrase;

  // Reset the type-to-confirm input each time the dialog opens so a
  // previously confirmed phrase never carries over to a new confirmation.
  useEffect(() => {
    if (isOpen) {
      setPhraseInput('');
    }
  }, [isOpen]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (pendingRef.current || !phraseMatches) {
      return;
    }

    pendingRef.current = true;
    setIsPending(true);

    try {
      await onConfirm();
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) {
        setIsPending(false);
      }
    }
  };

  const handleClose = () => {
    if (!pendingRef.current) {
      onClose();
    }
  };

  const captureCancelButton = (container: HTMLSpanElement | null) => {
    cancelRef.current = container?.querySelector('button') ?? null;
  };

  return (
    <Dialog
      open={isOpen}
      title={title}
      description={message}
      onClose={handleClose}
      initialFocusRef={cancelRef}
      footer={
        <>
          <span ref={captureCancelButton}>
            <Button variant="secondary" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
          </span>
          <Button
            variant={confirmStyle === 'danger' ? 'destructive' : 'primary'}
            onClick={handleConfirm}
            disabled={isPending || !phraseMatches}
            loading={isPending}
            loadingLabel="Working…"
          >
            {confirmText}
          </Button>
        </>
      }
    >
      {children}
      {requiresPhrase && (
        <Field label={`Type ${confirmationPhrase} to confirm`}>
          {({ id }) => (
            <Input
              id={id}
              value={phraseInput}
              onChange={(event) => setPhraseInput(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
      )}
    </Dialog>
  );
};

export default ConfirmationModal;
