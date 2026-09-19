import { Dialog } from '../../../components/ui/Dialog';
import formStyles from '../../../components/styles/Form.module.css';
import modalStyles from '../shared/ModalLayout.module.css';
import useAddUserModal from '../../../hooks/admin/useAddUserModal';

const AddUserModal = ({ isOpen, onClose, onSave }) => {
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

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Create New User"
    >
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
    </Dialog>
  );
};

export default AddUserModal;
