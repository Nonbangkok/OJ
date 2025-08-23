import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../Table.css'; // Use the new shared table styles
import EditUserModal from './EditUserModal';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null);

  const fetchUsers = async () => {
    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/admin/users`, { withCredentials: true });
      setUsers(response.data);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async (userId) => {
    if (window.confirm('Are you sure you want to delete this user and all their submissions?')) {
      try {
        await axios.delete(`${process.env.REACT_APP_API_URL}/api/admin/users/${userId}`, { withCredentials: true });
        fetchUsers();
      } catch (err) {
        console.error('Error deleting user:', err);
      }
    }
  };

  const handleSubmitUserModal = async (userId, userData) => {
    try {
      await axios.put(`${process.env.REACT_APP_API_URL}/api/admin/users/${userId}`, userData, { withCredentials: true });
      fetchUsers();
      setShowEditModal(false);
    } catch (err) {
      console.error('Error updating user:', err);
      alert(`Error updating user: ${err.response?.data?.message || err.message}`);
    }
  };

  if (loading) return <div>Loading users...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="management-container">
      <h2>User Management</h2>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.username}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td className="actions">
                  {user.role !== 'admin' && (
                    <>
                      <button onClick={() => setEditingUser(user)} className="edit-btn">
                        Edit
                      </button>
                      <button onClick={() => handleDeleteUser(user.id)} className="delete-btn">
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
          onSave={handleSubmitUserModal}
        />
      )}
    </div>
  );
};

export default UserManagement; 