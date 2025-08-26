import React, { useState } from 'react';
import formStyles from '../Form.module.css';
import modalStyles from './ModalLayout.module.css';

const AddUserModal = ({ isOpen, onClose, onSave }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');

  if (!isOpen) {
    return null;
  }

  const handleSave = () => {
    if (username.length < 3) {
      setError('Username must be at least 3 characters long.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    setError('');
    onSave({ username, password, role });
  };

  return (
    <div className={modalStyles['modal-overlay']}>
      <div className={formStyles['form-container']}>
        <h2>Create New User</h2>
        {error && <p className={formStyles['error-message']}>{error}</p>}
        <div className={formStyles['form-group']}>
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className={formStyles['form-group']}>
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className={formStyles['form-group']}>
          <label htmlFor="role">Role</label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
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

export default AddUserModal; 