import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../../components/ui';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  confirmStyle?: 'danger' | 'default';
  objectName?: string;
}

const ConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  confirmStyle = 'danger',
}: ConfirmationModalProps) => {
  const cancelRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (pendingRef.current) {
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
            disabled={isPending}
            loading={isPending}
            loadingLabel="Working…"
          >
            {confirmText}
          </Button>
        </>
      }
    />
  );
};

export default ConfirmationModal;
