import React, { useState, useEffect } from 'react';
import formStyles from '../Form.module.css';
import modalStyles from './ModalLayout.module.css';


const EditUserModal = ({ user, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    username: user?.username || '',
    role: user?.role || 'user',
  });

  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username,
        role: user.role,
      });
    }
  }, [user]);

  if (!user) {
    return null;
  }

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [id]: value,
    }));
  };

  const handleSave = () => {
    onSave(user.id, formData);
    onClose();
  };

  return (
    <div className={modalStyles['modal-overlay']}>
      <div className={formStyles['form-container']}>
        <h2>Edit User: {user.username}</h2>
        <div className={formStyles['form-group']}>
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            name="username"
            value={formData.username}
            onChange={handleChange}
          />
        </div>
        <div className={formStyles['form-group']}>
          <label htmlFor="role">Role</label>
          <select
            id="role"
            name="role"
            value={formData.role}
            onChange={handleChange}
          >
            <option value="user">User</option>
            <option value="staff">Staff</option>
          </select>
        </div>
        <div className={modalStyles['modal-actions']}>
          <button onClick={onClose} className={modalStyles['button-cancel']}>Cancel</button>
          <button onClick={handleSave} className={modalStyles['button-save']}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default EditUserModal; 