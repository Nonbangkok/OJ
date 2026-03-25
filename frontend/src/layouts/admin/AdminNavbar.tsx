import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ThemeToggleButton from '../../components/shared/ThemeToggleButton';
import styles from './AdminNavbar.module.css';
import { useTheme } from '../../context/ThemeContext';
import logo from '../../assets/logo512.png';
import darkmodeLogo from '../../assets/logo512_darkmode.png';
import { USER_ROLES } from '../../utils/constants';
import type { SliderStyle } from '../../types';

const AdminNavbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLUListElement | null>(null);
  const { theme } = useTheme(); // Get current theme
  const currentLogo = theme === 'dark' ? darkmodeLogo : logo; // Choose logo based on theme
  const [sliderStyle, setSliderStyle] = useState<SliderStyle>({ opacity: 0 });

  const handleLogout = () => {
    try {
      void logout();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const handleMouseEnter = (e: MouseEvent<HTMLLIElement>) => {
    const li = e.currentTarget;
    setSliderStyle({
      width: li.offsetWidth + 20,
      left: li.offsetLeft - 10,
      opacity: 1,
    });
  };

  const resetSlider = () => {
    try {
      const activeLink = navRef.current?.querySelector<HTMLAnchorElement>('a.active');
      if (activeLink && activeLink.parentElement) {
        const activeLi = activeLink.parentElement;
        setSliderStyle({
          width: activeLi.offsetWidth + 20,
          left: activeLi.offsetLeft - 10,
          opacity: 1,
        });
      } else {
        setSliderStyle((prev) => ({ ...prev, opacity: 0 }));
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
            {user?.role === USER_ROLES.ADMIN ? 'Admin Panel' : 'Staff Panel'}
          </NavLink>
        </div>
        <ul ref={navRef} className={styles['nav-links']} onMouseLeave={resetSlider}>
          <div className={styles.slider} style={sliderStyle} />
          {user?.role === USER_ROLES.ADMIN && (
            <li onMouseEnter={handleMouseEnter}><NavLink to="/admin/users">Users</NavLink></li>
          )}
          {(user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.STAFF) && (
            <>
              <li onMouseEnter={handleMouseEnter}><NavLink to="/admin/problems">Problems</NavLink></li>
              <li onMouseEnter={handleMouseEnter}><NavLink to="/admin/contests">Contests</NavLink></li>
            </>
          )}
          {user?.role === USER_ROLES.ADMIN && (
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
