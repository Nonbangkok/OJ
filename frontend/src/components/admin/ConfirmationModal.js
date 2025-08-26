import React from 'react';
import './ModalLayout.css';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="confirmation-modal-content">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button onClick={onClose} className="button-cancel">Cancel</button>
          <button onClick={onConfirm} className="button-danger">Confirm</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal; 