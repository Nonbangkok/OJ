import { Button, Dialog } from '../../../components/ui';
import formStyles from '../../../components/styles/Form.module.css';
import useEditUserModal from '../../../hooks/admin/useEditUserModal';
import modalStyles from '../shared/ModalLayout.module.css';


const EditUserModal = ({ user, onClose, onSave }) => {
  const {
    formData,
    handleChange,
    handleSave,
  } = useEditUserModal(user, onClose, onSave);

  return (
    <Dialog
      open={Boolean(user)}
      onClose={onClose}
      title={user ? `Edit User: ${user.username}` : 'Edit User'}
    >
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
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </Dialog>
  );
};

export default EditUserModal;
