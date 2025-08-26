import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import ThemeToggleButton from './ThemeToggleButton';
import './Navbar.css';

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
    <nav className="navbar">
      <div className="navbar-container">
        <NavLink to="/" className="nav-brand">Online Judge</NavLink>
        <ul className="nav-links">
          <li><NavLink to="/problems">Problems</NavLink></li>
          <li><NavLink to="/submissions">Submissions</NavLink></li>
          <li><NavLink to="/scoreboard">Scoreboard</NavLink></li>
          {(user?.role === 'admin' || user?.role === 'staff') && (
            <li><NavLink to="/admin">Admin Panel</NavLink></li>
          )}
        </ul>
        <div className="nav-actions">
          {user ? (
            <>
              <span className="username">Welcome, {user?.username}</span>
              <button onClick={handleLogout} className="logout-btn">Logout</button>
            </>
          ) : (
            <>
              <NavLink to="/login" className="nav-action-link">Login</NavLink>
              {!user && (
                <>
                  {registrationEnabled && <NavLink to="/register" className="nav-action-link">Register</NavLink>}
                </>
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