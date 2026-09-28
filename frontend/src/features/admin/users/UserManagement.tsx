import { useEffect, useState } from 'react';
import useUserManagement from '../../../hooks/admin/useUserManagement';
import { useAuth } from '../../../context/AuthContext';
import EditUserModal from './EditUserModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import AddUserModal from './AddUserModal';
import ResetPasswordModal from './ResetPasswordModal';
import BatchUserCreation from './BatchUserCreation';
import styles from '../shared/Management.module.css';
import adminService from '../../../services/adminService';
import tableStyles from '../../../components/styles/Table.module.css';
import { ActionMenu, Button, StatusBadge } from '../../../components/ui';
import type { AdminUser } from '../../../types';
import { USER_PAGE_SIZE } from '../../../hooks/admin/useUserManagement';
import { APP_CONSTANTS } from '../../../utils/constants';

const UserManagement = () => {
  // Keep the controlled search/filter state above the data hook so result
  // updates never replace the filter toolbar or its input element.
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const {
    users,
    page,
    total,
    loading,
    error,
    setError,
    editingUser,
    setEditingUser,
    deletingUser,
    setDeletingUser,
    isAddModalOpen,
    setIsAddModalOpen,
    fetchUsers,
    goToPage,
    handleEdit,
    handleDeleteClick,
    handleConfirmDelete,
    handleSave,
    handleAddNewUser
  } = useUserManagement(search, roleFilter);

  const { user: currentUser } = useAuth();

  // AUTH-004: target of the pending admin password reset.
  const [resettingPasswordUser, setResettingPasswordUser] = useState<AdminUser | null>(null);
  const [submissionLockTarget, setSubmissionLockTarget] = useState<AdminUser | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkLockAction, setBulkLockAction] = useState<boolean | null>(null);
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState('');

  // A selection belongs to the visible query and page, never to another page.
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkLockAction(null);
    setBulkMessage('');
    setBulkError('');
  }, [page, search, roleFilter]);

  const displayedIds = users.map((user) => user.id);
  const selectedDisplayedIds = displayedIds.filter((id) => selectedIds.has(id));
  const allDisplayedSelected = displayedIds.length > 0 && selectedDisplayedIds.length === displayedIds.length;

  const startBulkLock = (locked: boolean) => {
    setBulkMessage('');
    setBulkError('');
    setBulkLockAction(locked);
  };

  const confirmBulkLock = async () => {
    if (bulkLockAction === null || selectedDisplayedIds.length === 0) return;
    try {
      setBulkError('');
      const { updatedIds, skippedIds } = await adminService.setUsersSubmissionLock(
        selectedDisplayedIds, bulkLockAction,
      );
      setBulkLockAction(null);
      setSelectedIds(new Set());
      setBulkMessage(`Updated ${updatedIds.length} user${updatedIds.length === 1 ? '' : 's'}; `
        + `skipped ${skippedIds.length}${skippedIds.length ? ` (IDs: ${skippedIds.join(', ')})` : ''}.`
        + (skippedIds.length ? ' Skipped accounts are ineligible or no longer exist.' : ''));
      await fetchUsers(page);
    } catch (err) {
      setBulkLockAction(null);
      setBulkError('Failed to update selected users. Selection was kept; please retry.');
      console.error(err);
    }
  };

  // ADMIN-008: filtered totals and rows are both server-paged.
  const pageCount = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * USER_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * USER_PAGE_SIZE, total);

  return (
    <>
      <div className={styles['management-container']}>
        {/* --- Page header: creation only --------------------------------- */}
        <div className={styles['management-header']}>
          <h2>User Management</h2>
          <div className={styles['header-actions']}>
            <Button onClick={() => setIsAddModalOpen(true)}>+ New User</Button>
          </div>
        </div>

        {/* --- Filter / scope bar ----------------------------------------- */}
        <div className={styles['filter-bar']}>
          <input
            type="search"
            className={styles['filter-search']}
            placeholder="Search users…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search users"
          />
          <label className={styles['filter-control']}>
            <span className={styles['filter-label']}>Role</span>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              aria-label="Filter users by role"
            >
              <option value="all">All</option>
              {['admin', 'staff', 'user'].map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </label>
        </div>

        {loading && <p role="status">Loading users…</p>}
        {error && (
          <div className="error-message" role="alert">
            {error}{' '}
            <Button variant="secondary" size="compact" onClick={() => fetchUsers(page)}>
              Retry
            </Button>
          </div>
        )}
        {bulkError && <div className="error-message" role="alert">{bulkError}</div>}
        {bulkMessage && <p role="status">{bulkMessage}</p>}

        <div className={styles['bulk-actions']}>
          <span>{selectedDisplayedIds.length} selected on this page</span>
          <Button size="compact" variant="secondary" disabled={!selectedDisplayedIds.length || loading}
            onClick={() => startBulkLock(true)}>Lock selected</Button>
          <Button size="compact" variant="secondary" disabled={!selectedDisplayedIds.length || loading}
            onClick={() => startBulkLock(false)}>Unlock selected</Button>
        </div>

        {/* --- Table: Edit + overflow ------------------------------------ */}
        <div className={`${tableStyles['table-container']} ${styles.tableWrap}`}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select displayed users"
                    checked={allDisplayedSelected}
                    disabled={!displayedIds.length || loading}
                    onChange={(event) => setSelectedIds(event.target.checked
                      ? new Set(displayedIds) : new Set())}
                  />
                </th>
                <th className={styles['col-left']}>Username</th>
                <th className={styles['col-center']}>Role</th>
                <th className={styles['col-center']}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const canManage = currentUser && user.id !== currentUser.id
                  && user.username !== APP_CONSTANTS.SYSTEM_ADMIN_USERNAME;
                return (
                  <tr key={user.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${user.username}`}
                        checked={selectedIds.has(user.id)}
                        disabled={loading}
                        onChange={(event) => setSelectedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(user.id);
                          else next.delete(user.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className={styles['col-left']}>{user.username}</td>
                    <td className={styles['col-center']}>
                      <StatusBadge tone={user.role === 'admin' ? 'info' : 'neutral'} soft>
                        {user.role}
                      </StatusBadge>
                      {user.role === 'user' && user.submissions_locked && (
                        <StatusBadge tone="danger" soft>Submissions locked</StatusBadge>
                      )}
                    </td>
                    <td className={styles['col-center']}>
                      <div className={styles['row-actions']}>
                        <Button
                          size="compact"
                          variant="secondary"
                          disabled={!canManage}
                          onClick={() => handleEdit(user)}
                        >
                          Edit
                        </Button>
                        <ActionMenu
                          label={`Row actions for ${user.username}`}
                          items={[
                            ...(user.role === 'user' ? [{
                              key: 'submission-lock',
                              label: user.submissions_locked ? 'Unlock submissions' : 'Lock submissions',
                              disabled: !canManage,
                              onClick: () => setSubmissionLockTarget(user),
                            }] : []),
                            {
                              key: 'reset-password',
                              label: 'Reset password',
                              disabled: !canManage,
                              onClick: () => setResettingPasswordUser(user),
                            },
                            {
                              key: 'delete',
                              label: 'Delete',
                              variant: 'danger',
                              disabled: !canManage,
                              onClick: () => handleDeleteClick(user),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!users.length && !loading && !error && (
            <p className={styles['empty-state']}>No users found.</p>
          )}
        </div>

        {/* --- Pagination (ADMIN-008) ------------------------------------ */}
        {pageCount > 1 && (
          <div className={styles['filter-bar']} role="navigation" aria-label="User list pages">
            <Button
              variant="secondary"
              size="compact"
              disabled={page <= 1 || loading}
              onClick={() => goToPage(page - 1)}
            >
              Prev
            </Button>
            <span aria-live="polite">
              {rangeStart}–{rangeEnd} of {total}
            </span>
            <Button
              variant="secondary"
              size="compact"
              disabled={page >= pageCount || loading}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}

        {editingUser && (
          <EditUserModal
            user={editingUser}
            onClose={() => setEditingUser(null)}
            onSave={handleSave}
          />
        )}
        <ConfirmationModal
          isOpen={!!deletingUser}
          onClose={() => setDeletingUser(null)}
          onConfirm={handleConfirmDelete}
          title="Confirm Deletion"
          message={`Are you sure you want to delete user "${deletingUser?.username}"? All related submissions will also be deleted.`}
        />
        <ConfirmationModal
          isOpen={!!submissionLockTarget}
          onClose={() => setSubmissionLockTarget(null)}
          onConfirm={async () => {
            if (!submissionLockTarget) return;
            try {
              await adminService.setUserSubmissionLock(
                submissionLockTarget.id,
                !submissionLockTarget.submissions_locked,
              );
              setSubmissionLockTarget(null);
              await fetchUsers(page);
            } catch (err) {
              setError('Failed to update submission lock. Please retry.');
              console.error(err);
            }
          }}
          title={submissionLockTarget?.submissions_locked ? 'Unlock user submissions' : 'Lock user submissions'}
          message={submissionLockTarget?.submissions_locked
            ? `Allow ${submissionLockTarget?.username} to submit solutions and join contests again?`
            : `Lock ${submissionLockTarget?.username}? This will prevent this user from submitting and joining contests until unlocked.`}
          confirmText={submissionLockTarget?.submissions_locked ? 'Unlock' : 'Lock'}
          confirmStyle={submissionLockTarget?.submissions_locked ? 'default' : 'danger'}
        />
        <ConfirmationModal
          isOpen={bulkLockAction !== null}
          onClose={() => setBulkLockAction(null)}
          onConfirm={confirmBulkLock}
          title={bulkLockAction ? 'Lock selected users' : 'Unlock selected users'}
          message={`${bulkLockAction ? 'Lock' : 'Unlock'} ${selectedDisplayedIds.length} selected users? `
            + 'Only regular user accounts can be changed. The result will report skipped accounts.'}
          confirmText={bulkLockAction ? 'Lock' : 'Unlock'}
          confirmStyle={bulkLockAction ? 'danger' : 'default'}
        />
        <AddUserModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSave={handleAddNewUser}
        />
        <ResetPasswordModal
          user={resettingPasswordUser}
          onClose={() => setResettingPasswordUser(null)}
        />
      </div>
      <BatchUserCreation onUsersCreated={fetchUsers} />
    </>
  );
};

export default UserManagement;
