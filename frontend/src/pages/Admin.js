import React, { useState, useEffect } from 'react';
import axios from 'axios';
import UserManagement from '../components/admin/UserManagement';
import ProblemManagement from '../components/admin/ProblemManagement';
import RegistrationSettings from '../components/admin/RegistrationSettings';
import './Admin.css';

const API_URL = process.env.REACT_APP_API_URL;

const Admin = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await axios.get(`${API_URL}/me`, { withCredentials: true });
        if (response.data.isAuthenticated) {
          setUser(response.data.user);
        }
      } catch (error) {
        console.error("Could not fetch user data for admin panel", error);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="admin-container">
      <h1>Admin Panel</h1>
      
      {user?.role === 'admin' && (
        <div className="admin-section">
          <UserManagement />
        </div>
      )}

      {(user?.role === 'admin' || user?.role === 'staff') && (
        <div className="admin-section">
          <ProblemManagement currentUser={user} />
        </div>
      )}
      <div className="admin-section">
        <RegistrationSettings />
      </div>
    </div>
  );
};

export default Admin; 