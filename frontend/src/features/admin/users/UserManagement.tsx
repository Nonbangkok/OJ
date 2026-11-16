import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UsersThree } from '@phosphor-icons/react';
import {
  ActionMenu, BulkBar, Button, ConfirmDialog, DataTable, Dialog, FilterBar, InlineError, InlineNotice, PageHeader,
  SegmentedControl, StatusDot, type DataTableColumn,
} from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import { useUrlFilters } from '../../../hooks/useUrlFilters';
import adminService from '../../../services/adminService';
import type { AdminUser, UserRole } from '../../../types';
import { APP_CONSTANTS } from '../../../utils/constants';
import { downloadCsv } from '../../../utils/downloadCsv';
import { formatTimeAgo } from '../../../utils/formatters';
import AddUserModal from './AddUserModal';
import BatchCreateDrawer from './BatchCreateDrawer';
import ResetPasswordModal from './ResetPasswordModal';
import UserEditDrawer from './UserEditDrawer';
import styles from './Users.module.css';

const PAGE_SIZE = 50;
const FILTER_KEYS = ['q', 'role', 'locked'] as const;
const ROLE_SEGMENTS = [
  { value: 'all', label: 'All' }, { value: 'user', label: 'Students' }, { value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admins' },
] as const;
const ROLE_LABEL: Record<UserRole, string> = { user: 'Student', staff: 'Staff', admin: 'Admin' };
const JOINED = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isProtected = (u: AdminUser) => u.username === APP_CONSTANTS.SYSTEM_ADMIN_USERNAME;
const message = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? fallback;

/** Users (§7.8): filters, server-paged table, bulk lock/role/export, edit Drawer, typed delete. */
export default function UserManagement() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const { values, set } = useUrlFilters(FILTER_KEYS);
  const role = (values.role || 'all') as (typeof ROLE_SEGMENTS)[number]['value'];
  const locked = values.locked === 'locked' || values.locked === 'unlocked' ? values.locked : undefined;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: AdminUser[]; total: number } | null>(null);
  const [counts, setCounts] = useState<{ all: number; staff: number; admin: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [roleDialog, setRoleDialog] = useState<UserRole | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    adminService.getUsers({ page, limit: PAGE_SIZE, search: values.q || undefined, role, locked })
      .then((result) => { if (!cancelled) { setData({ users: result.users, total: result.total }); setError(null); } })
      .catch((err) => { if (!cancelled) setError(message(err, "Couldn't load users.")); });
    return () => { cancelled = true; };
  }, [page, values.q, role, locked, version]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      adminService.getUsers({ limit: 1 }), adminService.getUsers({ role: 'staff', limit: 1 }), adminService.getUsers({ role: 'admin', limit: 1 }),
    ]).then(([all, staff, admins]) => { if (!cancelled) setCounts({ all: all.total, staff: staff.total, admin: admins.total }); })
      .catch(() => { /* the header count is decoration */ });
    return () => { cancelled = true; };
  }, [version]);

  // Any filter change starts a fresh selection on page 1 (a selection only means what is on screen).
  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string | null) => {
    setSelected(new Set());
    setPage(1);
    set(key, value);
  };

  const users = data?.users ?? [];
  const selectedUsers = users.filter((u) => selected.has(String(u.id)));
  const selectedIds = selectedUsers.map((u) => u.id);

  const bulkLock = async (lockIt: boolean) => {
    try {
      // The selection stays, so the same set can be exported or re-roled next.
      await adminService.setUsersSubmissionLock(selectedIds, lockIt);
      refresh();
    } catch (err) { setError(message(err, "Couldn't update the selected users.")); }
  };

  const exportCsv = () => downloadCsv('users.csv', [
    ['username', 'role', 'status', 'solved', 'joined'],
    ...selectedUsers.map((u) => [u.username, u.role, u.submissions_locked ? 'locked' : 'active', String(u.solved_count ?? 0), u.created_at ?? '']),
  ]);

  const applyRole = async () => {
    if (!roleDialog) return;
    try {
      const result = await adminService.setUsersRole(selectedIds, roleDialog as 'user' | 'staff' | 'admin');
      setRoleDialog(null);
      setSelected(new Set());
      setNotice(result.skipped.length > 0
        ? `${result.updated.length} updated, ${result.skipped.length} user${result.skipped.length === 1 ? '' : 's'} skipped (the system admin and your own account keep their role).`
        : `${result.updated.length} updated.`);
      refresh();
    } catch (err) { setError(message(err, "Couldn't change the role.")); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await adminService.deleteUser(deleting.id);
      setDeleting(null);
      refresh();
    } catch (err) { setError(message(err, "Couldn't delete the user.")); setDeleting(null); }
  };

  const columns: DataTableColumn<AdminUser>[] = [
    { key: 'username', header: 'Username', mobile: 'primary', cell: (u) => <span className={styles.username}>{u.username}</span> },
    { key: 'role', header: 'Role', mobile: 'meta', cell: (u) => <span className={u.role === 'user' ? styles.muted : undefined}>{ROLE_LABEL[u.role]}</span> },
    { key: 'status', header: 'Status', mobile: 'meta', cell: (u) => <StatusDot tone={u.submissions_locked ? 'warn' : 'pass'} label={u.submissions_locked ? 'Locked' : 'Active'} /> },
    { key: 'solved', header: 'Solved', align: 'right', mobile: 'meta', cell: (u) => <span className={styles.mono}>{u.solved_count ?? 0}</span> },
    { key: 'joined', header: 'Joined', mobile: 'hidden', cell: (u) => <span className={styles.muted}>{u.created_at ? JOINED.format(new Date(u.created_at)) : '—'}</span> },
    { key: 'active', header: 'Last active', mobile: 'meta', cell: (u) => <span className={styles.muted}>{u.last_active_at ? formatTimeAgo(u.last_active_at) : '—'}</span> },
  ];

  const rowActions = (u: AdminUser) => (isProtected(u)
    ? [{ key: 'profile', label: 'View profile', onClick: () => navigate(`/profile/${u.username}`) }]
    : [
      { key: 'edit', label: 'Edit', onClick: () => setEditing(u) },
      { key: 'profile', label: 'View profile', onClick: () => navigate(`/profile/${u.username}`) },
      { key: 'password', label: 'Reset password', onClick: () => setResetting(u) },
      ...(u.id === me?.id ? [] : [{ key: 'delete', label: 'Delete user', variant: 'danger' as const, onClick: () => setDeleting(u) }]),
    ]);

  const meta = counts ? `${counts.all} accounts · ${counts.staff} staff · ${counts.admin} admin${counts.admin === 1 ? '' : 's'}` : undefined;
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Manage' }]}
        title="Users"
        meta={meta}
        actions={(
          <>
            <ActionMenu label="More user actions" items={[{ key: 'add', label: 'Add user', onClick: () => setAddOpen(true) }]} />
            <Button onClick={() => setBatchOpen(true)}><UsersThree size={16} aria-hidden="true" />Create users</Button>
          </>
        )}
      />
      <FilterBar
        search={{ value: values.q, onChange: (value) => setFilter('q', value || null), placeholder: 'Search username' }}
        segments={<SegmentedControl aria-label="Role" options={ROLE_SEGMENTS} value={role} onChange={(value) => setFilter('role', value === 'all' ? null : value)} />}
        filters={[{
          key: 'locked', label: 'Locked', value: locked,
          options: [{ value: 'locked', label: 'Locked' }, { value: 'unlocked', label: 'Not locked' }],
          onChange: (value) => setFilter('locked', value),
        }]}
        resultCount={data ? `${data.total} users` : undefined}
      />
      {error && <InlineError message={error} />}
      {notice && <InlineNotice title={notice} />}
      {selectedIds.length > 0 && (
        <BulkBar
          count={selectedIds.length}
          onClear={() => setSelected(new Set())}
          actions={[
            { key: 'lock', label: 'Lock', onClick: () => bulkLock(true) },
            { key: 'unlock', label: 'Unlock', onClick: () => bulkLock(false) },
            { key: 'role', label: 'Change role', onClick: () => setRoleDialog('user') },
            { key: 'export', label: 'Export CSV', onClick: exportCsv },
          ]}
        />
      )}
      <DataTable<AdminUser>
        caption="Users"
        columns={columns}
        rows={users}
        rowKey={(u) => String(u.id)}
        rowLabel={(u) => u.username}
        onRowClick={(u) => { if (!isProtected(u)) setEditing(u); }}
        rowActions={rowActions}
        selection={{ selected, onChange: setSelected }}
        loading={data === null && !error}
      />
      {lastPage > 1 && (
        <div className={styles.pager}>
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className={styles.mono}>{`${page} / ${lastPage}`}</span>
          <Button variant="secondary" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {editing && (
        <UserEditDrawer user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} onChanged={refresh} onResetPassword={(u) => setResetting(u)} />
      )}
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
      <BatchCreateDrawer open={batchOpen} onClose={() => setBatchOpen(false)} onDone={() => { setBatchOpen(false); refresh(); }} />
      <AddUserModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={async (userData) => { await adminService.createUser(userData as never); setAddOpen(false); refresh(); }}
      />
      <Dialog open={roleDialog !== null} title={`Change role for ${selectedIds.length} users`} onClose={() => setRoleDialog(null)}>
        <SegmentedControl
          aria-label="New role"
          options={[{ value: 'user', label: 'Student' }, { value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admin' }] as const}
          value={(roleDialog ?? 'user') as 'user' | 'staff' | 'admin'}
          onChange={(value) => setRoleDialog(value)}
        />
        <p className={styles.lead}>The system admin and your own account keep their role.</p>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={() => setRoleDialog(null)}>Cancel</Button>
          <Button onClick={applyRole}>Change role</Button>
        </div>
      </Dialog>
      {deleting && (
        <ConfirmDialog
          open
          tier="typed"
          title={`Delete ${deleting.username}?`}
          body={`This deletes the account and its ${deleting.submission_count ?? 0} submissions and ${deleting.solved_count ?? 0} solves (XP and ranking). It cannot be undone.`}
          confirmLabel="Delete user"
          confirmText={deleting.username}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
