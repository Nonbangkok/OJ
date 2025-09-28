import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggleButton from './ThemeToggleButton';
import styles from './AdminNavbar.module.css';
import { useTheme } from '../context/ThemeContext'; // Import useTheme
import logo from '../assets/logo512.png'; // Import default logo
import darkmodeLogo from '../assets/logo512_darkmode.png'; // Import dark mode logo

const AdminNavbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef(null);
  const { theme } = useTheme(); // Get current theme
  const currentLogo = theme === 'dark' ? darkmodeLogo : logo; // Choose logo based on theme
  const [sliderStyle, setSliderStyle] = useState({ opacity: 0 });

  const handleLogout = () => {
    try {
      logout();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
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
          <NavLink to="/" className={styles['back-btn']}>
            <img src={currentLogo} alt="Grader Logo" className={styles['nav-logo']} />
          </NavLink>
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