import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import ThemeToggleButton from './ThemeToggleButton';
import styles from './Navbar.module.css';

const Navbar = () => {
  const { user, logout } = useAuth();
  const { registrationEnabled } = useSettings();
  const navigate = useNavigate();

  const handleLogout = () => {
    try {
      logout();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <nav className={styles.navbar}>
      <div className={styles['navbar-container']}>
        <NavLink to="/" className={styles['nav-brand']}>Online Judge</NavLink>
        <ul className={styles['nav-links']}>
          <li><NavLink to="/problems">Problems</NavLink></li>
          <li><NavLink to="/contests">Contests</NavLink></li>
          <li><NavLink to="/submissions">Submissions</NavLink></li>
          <li><NavLink to="/scoreboard">Scoreboard</NavLink></li>
          {user?.role === 'admin' && (
            <li><NavLink to="/admin">Admin Panel</NavLink></li>
          )}
          {user?.role === 'staff' && (
            <li><NavLink to="/admin">Staff Panel</NavLink></li>
          )}
        </ul>
        <div className={styles['nav-actions']}>
          {user ? (
            <>
              <span className={styles.username}>{user?.username}</span>
              <button onClick={handleLogout} className={styles['logout-btn']}>Logout</button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={styles['nav-action-link']}>Login</NavLink>
              {/* Conditionally render the Register link based on the setting */}
              {registrationEnabled && (
                <NavLink to="/register" className={styles['nav-action-link']}>Register</NavLink>
              )}
            </>
          )}
          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 