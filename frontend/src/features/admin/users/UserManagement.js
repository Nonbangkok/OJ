import useUserManagement from '../../../hooks/admin/useUserManagement';
import { useAuth } from '../../../context/AuthContext'; // Import useAuth
import EditUserModal from './EditUserModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import AddUserModal from './AddUserModal';
import BatchUserCreation from './BatchUserCreation'; // Import the new component
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import { APP_CONSTANTS } from '../../../utils/constants';

const UserManagement = () => {
  const {
    users,
    loading,
    error,
    editingUser,
    setEditingUser,
    deletingUser,
    setDeletingUser,
    isAddModalOpen,
    setIsAddModalOpen,
    fetchUsers,
    handleEdit,
    handleDeleteClick,
    handleConfirmDelete,
    handleSave,
    handleAddNewUser
  } = useUserManagement();

  const { user: currentUser } = useAuth(); // Get the currently logged-in user

  if (loading) return <div>Loading users...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <>
      <div className={styles['management-container']}>
        <div className={styles['management-header']}>
          <h2>User Management</h2>
          <button onClick={() => setIsAddModalOpen(true)} className={styles['create-btn']}>
            Create New User
          </button>
        </div>
        <div className={tableStyles['table-container']}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.role}</td>
                  <td>
                    <div className={styles.actions}>
                      {/* Show buttons if:
                        1. There is a logged-in user (currentUser exists)
                        2. The user in the row is NOT the currently logged-in user
                        3. The username is NOT "APP_CONSTANTS.SYSTEM_ADMIN_USERNAME"
                    */}
                      {currentUser && user.id !== currentUser.id && user.username !== APP_CONSTANTS.SYSTEM_ADMIN_USERNAME && (
                        <>
                          <button onClick={() => handleEdit(user)} className={styles['edit-btn']}>
                            Edit
                          </button>
                          <button onClick={() => handleDeleteClick(user)} className={styles['delete-btn']}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      </div>
      <BatchUserCreation onUsersCreated={fetchUsers} />
    </>
  );
};

export default UserManagement; 