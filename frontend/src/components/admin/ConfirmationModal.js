import React from 'react';
import styles from './ModalLayout.module.css';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;

  return (
    <div className={styles['modal-overlay']}>
      <div className={styles['confirmation-modal-content']}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className={styles['modal-actions']}>
          <button onClick={onClose} className={styles['button-cancel']}>Cancel</button>
          <button onClick={onConfirm} className={styles['button-danger']}>Confirm</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal; 