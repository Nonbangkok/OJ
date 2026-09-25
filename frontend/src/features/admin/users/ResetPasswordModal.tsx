import { useEffect, useState } from 'react';

import { Button, Dialog, Field, Input } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import type { AdminUser } from '../../../types';

import styles from './ResetPasswordModal.module.css';

/** Mirrors the backend USER_VALIDATION.MIN_PASSWORD_LENGTH. */
const MIN_PASSWORD_LENGTH = 8;

interface ResetPasswordModalProps {
  user: AdminUser | null;
  onClose: () => void;
}

/**
 * AUTH-004: admin-set password reset. The admin types the new password
 * directly (no email infrastructure for a temp-password flow); on success
 * the target is signed out of every device and must sign in again.
 */
const ResetPasswordModal = ({ user, onClose }: ResetPasswordModalProps) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [serverError, setServerError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset the form each time the dialog opens so no password ever carries
  // over between users.
  useEffect(() => {
    if (user) {
      setNewPassword('');
      setConfirmPassword('');
      setConfirmError('');
      setServerError('');
      setSuccessMessage('');
    }
  }, [user]);

  if (!user) return null;

  const validate = (): string | null => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
    }
    if (newPassword !== confirmPassword) {
      return 'Passwords do not match.';
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setConfirmError(validationError);
      return;
    }
    setConfirmError('');
    setServerError('');
    setIsSubmitting(true);
    try {
      const response = await adminService.resetUserPassword(user.id, { newPassword });
      setSuccessMessage(response.message);
    } catch (error) {
      setServerError(getErrorMessage(error, 'Failed to reset password.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <Dialog open title={`Reset Password — ${user.username}`} onClose={onClose}>
        <p className={styles['success-message']} role="status">{successMessage}</p>
        <div className={styles.actions}>
          <Button onClick={onClose}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      title={`Reset Password — ${user.username}`}
      description="Sets the new password directly and signs this user out of every device. They will need to sign in again."
      onClose={onClose}
    >
      {serverError && <p className={styles['error-message']} role="alert">{serverError}</p>}
      {confirmError && <p className={styles['error-message']} role="alert">{confirmError}</p>}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSubmitting) void handleSubmit();
        }}
      >
        <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} required>
          {({ id, ...controlProps }) => (
            <Input
              {...controlProps}
              id={id}
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label="Confirm new password" required>
          {({ id, ...controlProps }) => (
            <Input
              {...controlProps}
              id={id}
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} loadingLabel="Resetting…">
            Reset Password
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default ResetPasswordModal;
