import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../Table.css'; // Use the new shared table styles
import EditUserModal from './EditUserModal';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null);

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

  const handleDelete = async (userId) => {
    if (window.confirm('Are you sure you want to delete this user and all their submissions?')) {
      try {
        await axios.delete(`${API_URL}/api/admin/users/${userId}`, { withCredentials: true });
        setUsers(users.filter(user => user.id !== userId));
      } catch (err) {
        setError('Failed to delete user.');
        console.error(err);
      }
    }
  };

  const handleSaveUser = async (userId, userData) => {
    try {
      await axios.put(`${API_URL}/api/admin/users/${userId}`, userData, { withCredentials: true });
      setEditingUser(null);
      fetchUsers(); // Refresh the user list
    } catch (err) {
      setError('Failed to save user details.');
      console.error(err);
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
                      <button onClick={() => handleDelete(user.id)} className="delete-btn">
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
          onSave={handleSaveUser}
        />
      )}
    </div>
  );
};

export default UserManagement; 