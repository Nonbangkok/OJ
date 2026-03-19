import React from 'react';
import { ConfirmationModalProps } from '../../../types';
import styles from './ModalLayout.module.css';

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmStyle = 'primary'
}) => {
  if (!isOpen) return null;

  return (
    <div className={styles['modal-overlay']} onClick={onClose}>
      <div className={styles['confirmation-modal-content']} onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className={styles['modal-actions']}>
          <button className={styles['button-cancel']} onClick={onClose}>{cancelText}</button>
          <button 
            className={`${styles['button-danger']} ${styles[confirmStyle]}`} 
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal; 