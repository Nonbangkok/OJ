import { useEffect, useState } from 'react';
import { Key } from '@phosphor-icons/react';

import { Button, Dialog, Field, Input } from '../ui';
import authService from '../../services/authService';
import { getErrorMessage } from '../../utils/error';

import styles from './ChangePasswordDialog.module.css';

/** Mirrors the backend USER_VALIDATION.MIN_PASSWORD_LENGTH (Phase 1 raised it to 8). */
const MIN_PASSWORD_LENGTH = 8;

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * AUTH-004: self-service password change. Verifies the current password
 * client-side (min length, confirm match, not-identical), then delegates to
 * the backend which re-verifies it against the stored bcrypt hash and signs
 * out every other session.
 */
const ChangePasswordDialog = ({ open, onClose }: ChangePasswordDialogProps) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [serverError, setServerError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset the form each time the dialog opens so no password ever carries
  // over between opens.
  useEffect(() => {
    if (open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setConfirmError('');
      setServerError('');
      setSuccessMessage('');
    }
  }, [open]);

  if (!open) return null;

  const validate = (): string | null => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return `New password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
    }
    if (newPassword !== confirmPassword) {
      return 'New passwords do not match.';
    }
    if (newPassword === currentPassword) {
      return 'The new password must be different from the current one.';
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
      const response = await authService.changePassword({
        currentPassword,
        newPassword,
      });
      setSuccessMessage(response.message);
    } catch (error) {
      setServerError(getErrorMessage(error, 'Failed to change password.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <Dialog open={open} title="Change Password" onClose={onClose}>
        <p className={styles['success-message']} role="status">{successMessage}</p>
        <div className={styles.actions}>
          <Button onClick={onClose}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      title="Change Password"
      description="Changing your password signs out all your other sessions."
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
        <Field label="Current password" required>
          {({ id, ...controlProps }) => (
            <Input
              {...controlProps}
              id={id}
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          )}
        </Field>
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
          <Button type="submit" loading={isSubmitting} loadingLabel="Changing…">
            <span className={styles['submit-label']}>
              <Key size={14} aria-hidden="true" /> Change Password
            </span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default ChangePasswordDialog;
