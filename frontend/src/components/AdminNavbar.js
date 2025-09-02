import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggleButton from './ThemeToggleButton';
import styles from './AdminNavbar.module.css';

// Copied from ContestNavbar.js
const ArrowLeftIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="19" y1="12" x2="5" y2="12"></line>
    <polyline points="12 19 5 12 12 5"></polyline>
  </svg>
);

const AdminNavbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    try {
      logout();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const handleExit = () => {
    navigate('/');
  };

  return (
    <nav className={styles.navbar}>
      <div className={styles['navbar-container']}>
        <div className={styles['nav-left']}>
          <button onClick={handleExit} className={styles['back-btn']} title="Exit Admin Panel">
            <ArrowLeftIcon />
          </button>
          <NavLink to="/admin" className={styles['nav-brand']}>
            {user?.role === 'admin' ? 'Admin Panel' : 'Staff Panel'}
          </NavLink>
        </div>
        <ul className={styles['nav-links']}>
          {user?.role === 'admin' && (
            <li><NavLink to="/admin/users">Users</NavLink></li>
          )}
          {(user?.role === 'admin' || user?.role === 'staff') && (
            <>
              <li><NavLink to="/admin/problems">Problems</NavLink></li>
              <li><NavLink to="/admin/contests">Contests</NavLink></li>
            </>
          )}
          {user?.role === 'admin' && (
            <li><NavLink to="/admin/settings">Settings</NavLink></li>
          )}
        </ul>
        <div className={styles['nav-actions']}>
          {user && (
            <>
              <span className={styles.username}>{user.username}</span>
              <button onClick={handleLogout} className={styles['logout-btn']}>Logout</button>
            </>
          )}
          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
};

export default AdminNavbar; 