import formStyles from '../../../components/styles/Form.module.css';
import useEditUserModal from '../../../hooks/admin/useEditUserModal';
import modalStyles from '../shared/ModalLayout.module.css';
import type { User } from '../../../types';

interface EditUserModalProps {
  user: User;
  onClose: () => void;
  onSave: (userId: string | number, userData: Partial<User>) => void;
}

const EditUserModal = ({ user, onClose, onSave }: EditUserModalProps) => {
  const {
    formData,
    handleChange,
    handleSave,
  } = useEditUserModal(user, onClose, onSave);

  if (!user) {
    return null;
  }

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
            <option value="admin">Admin</option>
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