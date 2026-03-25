import styles from './ModalLayout.module.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  confirmStyle?: 'danger' | 'default';
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
  if (!isOpen) return null;

  const confirmClass =
    confirmStyle === 'danger' ? styles['button-danger'] : styles['button-save'];

  return (
    <div className={styles['modal-overlay']}>
      <div className={styles['confirmation-modal-content']}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className={styles['modal-actions']}>
          <button onClick={onClose} className={styles['button-cancel']}>Cancel</button>
          <button onClick={onConfirm} className={confirmClass}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal; 
