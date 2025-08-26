import React, { useState, useEffect } from 'react';
import '../Form.css';
import './ModalLayout.css';


const EditUserModal = ({ user, onClose, onSave }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setRole(user.role);
    }
  }, [user]);

  if (!user) {
    return null;
  }

  const handleSave = () => {
    onSave(user.id, { email, role });
  };

  return (
    <div className="modal-backdrop">
      <div className="form-container">
        <h2>Edit User: {user.username}</h2>
        <div className="form-group">
          <label htmlFor="email">Email:</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="role">Role:</label>
          <select 
            id="role" 
            value={role} 
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="user">User</option>
            <option value="staff">Staff</option>
          </select>
        </div>
        <div className="modal-actions">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button onClick={handleSave} className="save-btn">Save</button>
        </div>
      </div>
    </div>
  );
};

export default EditUserModal; 