import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Navbar.css';
import ThemeToggleButton from './ThemeToggleButton'; // Import the button

const API_URL = process.env.REACT_APP_API_URL;

function Navbar() {
  const [auth, setAuth] = useState({ isAuthenticated: false, user: null });
  const navigate = useNavigate();

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/me`, {
        withCredentials: true
      });
      setAuth({ isAuthenticated: response.data.isAuthenticated, user: response.data.user });
    } catch (error) {
      console.error('Error checking auth status:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_URL}/logout`, {}, {
        withCredentials: true
      });
      setAuth({ isAuthenticated: false, user: null });
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="nav-brand">Online Judge</Link>
        <ul className="nav-links">
          <li><Link to="/problems">Problems</Link></li>
          <li><Link to="/submissions">Submissions</Link></li>
          <li><Link to="/scoreboard">Scoreboard</Link></li>
          {(auth.user?.role === 'admin' || auth.user?.role === 'staff') && (
            <li><Link to="/admin">Admin Panel</Link></li>
          )}
        </ul>
        <div className="nav-actions">
          {auth.isAuthenticated ? (
            <>
              <span className="username">Welcome, {auth.user?.username}</span>
              <button onClick={handleLogout} className="logout-btn">Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-action-link">Login</Link>
              <Link to="/register" className="nav-action-link">Register</Link>
            </>
          )}
          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 