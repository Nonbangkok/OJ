import { useState, useEffect } from 'react';
import adminService from '../../../services/adminService';
import { useAuth } from '../../../context/AuthContext'; // Import useAuth
import EditUserModal from './EditUserModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import AddUserModal from './AddUserModal';
import BatchUserCreation from './BatchUserCreation'; // Import the new component
import styles from '../shared/Management.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import { APP_CONSTANTS } from '../../../utils/constants';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null); // Controls the EditUserModal
  const [deletingUser, setDeletingUser] = useState(null); // Controls the ConfirmationModal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false); // State for the new modal
  const { user: currentUser } = useAuth(); // Get the currently logged-in user

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await adminService.getUsers();
      setUsers(data);
    } catch (err) {
      setError('Failed to fetch users.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleEdit = (user) => {
    setEditingUser(user);
  };

  const handleDeleteClick = (user) => {
    setDeletingUser(user);
  };

  const handleConfirmDelete = async () => {
    if (deletingUser) {
      try {
        await adminService.deleteUser(deletingUser.id);
        setUsers(users.filter(user => user.id !== deletingUser.id));
      } catch (err) {
        setError('Failed to delete user.');
        console.error(err);
      } finally {
        setDeletingUser(null);
      }
    }
  };

  const handleSave = async (userId, userData) => {
    try {
      await adminService.updateUser(userId, userData);
      setEditingUser(null);
      fetchUsers(); // Refresh the user list
    } catch (err) {
      setError('Failed to save user details.');
      console.error(err);
    }
  };

  const handleAddNewUser = async (newUserData) => {
    try {
      await adminService.createUser(newUserData);
      setIsAddModalOpen(false);
      fetchUsers(); // Refresh the user list
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create user.');
      console.error(err);
      // Note: We might want to display this error inside the modal in a future enhancement
    }
  };

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