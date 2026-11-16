import { useState } from 'react';
import { Button, Drawer, Field, InlineError, SegmentedControl, SettingsRow } from '../../../components/ui';
import adminService from '../../../services/adminService';
import type { AdminUser, UserRole } from '../../../types';
import styles from './Users.module.css';

const JOINED = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const ROLES: Array<{ value: UserRole; label: string }> = [
  { value: 'user', label: 'Student' }, { value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admin' },
];

/** Edit one account (§7.8 Drawer): username, role, submission lock, password reset. */
export default function UserEditDrawer({ user, onClose, onSaved, onChanged, onResetPassword }: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
  /** Part of the edit landed (the list should refresh) but the drawer stays open. */
  onChanged?: () => void;
  onResetPassword: (user: AdminUser) => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState<UserRole>(user.role);
  const [locked, setLocked] = useState(Boolean(user.submissions_locked));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the server holds after each step, so a retry only sends what hasn't landed yet.
  const [saved, setSaved] = useState({ username: user.username, role: user.role, locked: Boolean(user.submissions_locked) });

  const messageOf = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? fallback;

  const save = async () => {
    setBusy(true);
    setError(null);
    const name = username.trim();
    let accountSaved = false;
    try {
      if (name !== saved.username || role !== saved.role) {
        await adminService.updateUser(user.id, { username: name, role });
        accountSaved = true;
        setSaved((prev) => ({ ...prev, username: name, role }));
      }
      if (locked !== saved.locked) await adminService.setUserSubmissionLock(user.id, locked);
      onSaved();
    } catch (err) {
      if (accountSaved) {
        setError(`Username and role saved. The submission lock didn't change: ${messageOf(err, 'unknown error')}`);
        onChanged?.();
      } else {
        setError(messageOf(err, "Couldn't save the changes."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open title={`Edit ${user.username}`} onClose={onClose}>
      <p className={styles.lead}>
        {`Joined ${user.created_at ? JOINED.format(new Date(user.created_at)) : '—'} · ${user.solved_count ?? 0} solved · ${user.submission_count ?? 0} submissions`}
      </p>
      {error && <InlineError message={error} />}
      <Field label="Username">
        {(control) => <input {...control} className={styles.input} value={username} onChange={(e) => setUsername(e.target.value)} />}
      </Field>
      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Role</span>
        <SegmentedControl aria-label="Role" options={ROLES} value={role} onChange={(value) => setRole(value as UserRole)} />
      </div>
      {role === 'user' && (
        <SettingsRow
          label="Lock submissions"
          help={`${user.username} can still log in and read problems, but cannot submit or join contests.`}
          control={<input type="checkbox" role="switch" aria-label="Lock submissions" checked={locked} onChange={(e) => setLocked(e.target.checked)} />}
        />
      )}
      <SettingsRow
        label="Password"
        help="Set a new one and share it with the user."
        control={<Button variant="secondary" onClick={() => onResetPassword(user)}>Reset password</Button>}
      />
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy || username.trim().length === 0} loading={busy} loadingLabel="Saving…">Save changes</Button>
      </div>
    </Drawer>
  );
}
