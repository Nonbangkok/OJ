import { useEffect } from 'react';

import { Button, Dialog, Field, Input, Select } from '../../../components/ui';
import useAddUserModal from '../../../hooks/admin/useAddUserModal';
import { STRING_LIMITS, USER_VALIDATION } from '../../../utils/constants';

import styles from './ResetPasswordModal.module.css';

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Create the user; reject the promise to surface an inline error. */
  onSave: (userData: { username: string; password: string; role: string }) => unknown;
}

/**
 * Admin "Create New User" dialog. Field hints state the account policy
 * (mirroring the backend createAdminUserSchema), validation runs
 * client-side before the request, and server rejections render inline
 * while the dialog stays open.
 */
const AddUserModal = ({ isOpen, onClose, onSave }: AddUserModalProps) => {
  const {
    username,
    setUsername,
    password,
    setPassword,
    role,
    setRole,
    fieldErrors,
    serverError,
    isSubmitting,
    resetForm,
    handleSave
  } = useAddUserModal(onSave);

  // Reset the form each time the dialog opens so nothing carries over
  // between users (the password field especially).
  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen, resetForm]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Create New User"
    >
      {serverError && <p className={styles['error-message']} role="alert">{serverError}</p>}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSubmitting) void handleSave();
        }}
      >
        <Field
          label="Username"
          hint={`Between ${USER_VALIDATION.MIN_USERNAME_LENGTH} and ${STRING_LIMITS.USERNAME} characters.`}
          error={fieldErrors.username}
          required
        >
          {({ id, ...controlProps }) => (
            <Input
              {...controlProps}
              id={id}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={`At least ${USER_VALIDATION.MIN_PASSWORD_LENGTH} characters.`}
          error={fieldErrors.password}
          required
        >
          {({ id, ...controlProps }) => (
            <Input
              {...controlProps}
              id={id}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label="Role" required>
          {({ id, ...controlProps }) => (
            <Select
              {...controlProps}
              id={id}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="user">User</option>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </Select>
          )}
        </Field>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} loadingLabel="Creating…">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default AddUserModal;
