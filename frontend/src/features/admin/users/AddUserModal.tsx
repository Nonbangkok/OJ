import formStyles from '../../../components/styles/Form.module.css';
import modalStyles from '../shared/ModalLayout.module.css';
import useAddUserModal from '../../../hooks/admin/useAddUserModal';
import type { User } from '../../../types';

interface CreateUser {
  username: string;
  password: string;
  role: User['role'];
}

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (userData: CreateUser) => Promise<void>;
}

const AddUserModal = ({ isOpen, onClose, onSave }: AddUserModalProps) => {
  const {
    username,
    setUsername,
    password,
    setPassword,
    role,
    setRole,
    error,
    handleSave
  } = useAddUserModal(onSave);

  if (!isOpen) return null;

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