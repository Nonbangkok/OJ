import React, { useState, useEffect } from 'react';
import axios from 'axios';
import EditUserModal from './EditUserModal';
import ConfirmationModal from './ConfirmationModal';
import AddUserModal from './AddUserModal'; // Import the new modal
import styles from './Management.module.css';

const API_URL = process.env.REACT_APP_API_URL;

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null); // Controls the EditUserModal
  const [deletingUser, setDeletingUser] = useState(null); // Controls the ConfirmationModal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false); // State for the new modal

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/admin/users`, { withCredentials: true });
      setUsers(response.data);
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
        await axios.delete(`${API_URL}/api/admin/users/${deletingUser.id}`, { withCredentials: true });
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
      await axios.put(`${API_URL}/api/admin/users/${userId}`, userData, { withCredentials: true });
      setEditingUser(null);
      fetchUsers(); // Refresh the user list
    } catch (err) {
      setError('Failed to save user details.');
      console.error(err);
    }
  };

  const handleAddNewUser = async (newUserData) => {
    try {
      await axios.post(`${API_URL}/api/admin/users`, newUserData, { withCredentials: true });
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
    <div className={styles['management-container']}>
      <div className={styles['management-header']}>
        <h2>User Management</h2>
        <button onClick={() => setIsAddModalOpen(true)} className={styles['create-btn']}>
          Create New User
        </button>
      </div>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.username}</td>
                <td>{user.role}</td>
                <td className={styles.actions}>
                  {user.role !== 'admin' && (
                    <>
                      <button onClick={() => handleEdit(user)} className={styles['edit-btn']}>
                        Edit
                      </button>
                      <button onClick={() => handleDeleteClick(user)} className={styles['delete-btn']}>
                        Delete
                      </button>
                    </>
                  )}
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
  );
};

export default UserManagement; 