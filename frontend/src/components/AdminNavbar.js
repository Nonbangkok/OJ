import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const navRef = useRef(null);
  const [sliderStyle, setSliderStyle] = useState({ opacity: 0 });

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

  const handleMouseEnter = (e) => {
    const li = e.currentTarget;
    setSliderStyle({
      width: li.offsetWidth + 20,
      left: li.offsetLeft - 10,
      opacity: 1,
    });
  };

  const resetSlider = () => {
    try {
      const activeLink = navRef.current?.querySelector('a.active');
      if (activeLink && activeLink.parentElement) {
        const activeLi = activeLink.parentElement;
        setSliderStyle({
          width: activeLi.offsetWidth + 20,
          left: activeLi.offsetLeft - 10,
          opacity: 1,
        });
      } else {
        setSliderStyle({ ...sliderStyle, opacity: 0 });
      }
    } catch (e) {
      setSliderStyle({ opacity: 0 });
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      resetSlider();
    }, 150);
    return () => clearTimeout(timer);
  }, [location.pathname, user]);

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
        <ul ref={navRef} className={styles['nav-links']} onMouseLeave={resetSlider}>
          <div className={styles.slider} style={sliderStyle} />
          {user?.role === 'admin' && (
            <li onMouseEnter={handleMouseEnter}><NavLink to="/admin/users">Users</NavLink></li>
          )}
          {(user?.role === 'admin' || user?.role === 'staff') && (
            <>
              <li onMouseEnter={handleMouseEnter}><NavLink to="/admin/problems">Problems</NavLink></li>
              <li onMouseEnter={handleMouseEnter}><NavLink to="/admin/contests">Contests</NavLink></li>
            </>
          )}
          {user?.role === 'admin' && (
            <li onMouseEnter={handleMouseEnter}><NavLink to="/admin/settings">Settings</NavLink></li>
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