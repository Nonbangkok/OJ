import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import ThemeToggleButton from './ThemeToggleButton';
import styles from './Navbar.module.css';
import { useTheme } from '../context/ThemeContext'; // Import useTheme
import logo from '../assets/logo512.png'; // Import default logo
import darkmodeLogo from '../assets/logo512_darkmode.png'; // Import dark mode logo

const Navbar = () => {
  const { user, logout } = useAuth();
  const { registrationEnabled } = useSettings();
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
      // Catch potential errors if navRef.current is not available
      setSliderStyle({ opacity: 0 });
    }
  };

  useEffect(() => {
    // Delay to ensure DOM is ready for measurement, especially on initial load
    const timer = setTimeout(() => {
      resetSlider();
    }, 150);
    return () => clearTimeout(timer);
  }, [location.pathname, user]); // Re-calculate on path or user change

  return (
    <nav className={styles.navbar}>
      <div className={styles['navbar-container']}>
        <NavLink to="/" className={styles['nav-brand']}>
          <img src={currentLogo} alt="WOI Grader Logo" className={styles['nav-logo']} />
          WOI Grader
        </NavLink>
        <ul ref={navRef} className={styles['nav-links']} onMouseLeave={resetSlider}>
          <div className={styles.slider} style={sliderStyle} />
          <li onMouseEnter={handleMouseEnter}><NavLink to="/problems">Problems</NavLink></li>
          <li onMouseEnter={handleMouseEnter}><NavLink to="/submissions">Submissions</NavLink></li>
          <li onMouseEnter={handleMouseEnter}><NavLink to="/scoreboard">Scoreboard</NavLink></li>
          <li onMouseEnter={handleMouseEnter}><NavLink to="/contests">Contests</NavLink></li>
          {user?.role === 'admin' && (
            <li onMouseEnter={handleMouseEnter}><NavLink to="/admin">Admin Panel</NavLink></li>
          )}
          {user?.role === 'staff' && (
            <li onMouseEnter={handleMouseEnter}><NavLink to="/admin">Staff Panel</NavLink></li>
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