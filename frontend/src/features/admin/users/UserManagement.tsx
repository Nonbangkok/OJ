import { useMemo, useState } from 'react';
import useUserManagement from '../../../hooks/admin/useUserManagement';
import { useAuth } from '../../../context/AuthContext';
import EditUserModal from './EditUserModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import AddUserModal from './AddUserModal';
import ResetPasswordModal from './ResetPasswordModal';
import BatchUserCreation from './BatchUserCreation';
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import { ActionMenu, Button, StatusBadge } from '../../../components/ui';
import type { AdminUser } from '../../../types';
import { USER_PAGE_SIZE } from '../../../hooks/admin/useUserManagement';
import { APP_CONSTANTS } from '../../../utils/constants';
import LoadingPage from '../../../components/shared/LoadingPage';

const UserManagement = () => {
  const {
    users,
    page,
    total,
    loading,
    error,
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
  } = useUserManagement();

  const { user: currentUser } = useAuth();

  // AUTH-004: target of the pending admin password reset.
  const [resettingPasswordUser, setResettingPasswordUser] = useState<AdminUser | null>(null);

  // --- Filters: username search x role -----------------------------------
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const roles = useMemo(
    () => [...new Set(users.map(user => user.role))].sort(),
    [users],
  );

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter(user => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (!query) return true;
      return user.username.toLowerCase().includes(query);
    });
  }, [users, roleFilter, search]);

  // ADMIN-008: server-side paging. The search/role filters above apply
  // within the fetched page; the pager walks the full user table.
  const pageCount = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * USER_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * USER_PAGE_SIZE, total);

  if (loading) return <LoadingPage />;
  if (error) return <div className="error-message">{error}</div>;

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
              {roles.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </label>
        </div>

        {/* --- Table: Edit + overflow ------------------------------------ */}
        <div className={`${tableStyles['table-container']} ${styles.tableWrap}`}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th className={styles['col-left']}>Username</th>
                <th className={styles['col-center']}>Role</th>
                <th className={styles['col-center']}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map(user => {
                const canManage = currentUser && user.id !== currentUser.id
                  && user.username !== APP_CONSTANTS.SYSTEM_ADMIN_USERNAME;
                return (
                  <tr key={user.id}>
                    <td className={styles['col-left']}>{user.username}</td>
                    <td className={styles['col-center']}>
                      <StatusBadge tone={user.role === 'admin' ? 'info' : 'neutral'} soft>
                        {user.role}
                      </StatusBadge>
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
          {!visibleUsers.length && (
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
