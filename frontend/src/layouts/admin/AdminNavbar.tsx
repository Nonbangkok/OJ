import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import logo from '../../assets/logo512.png';
import darkmodeLogo from '../../assets/logo512_darkmode.png';
import ThemeToggleButton from '../../components/shared/ThemeToggleButton';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { USER_ROLES } from '../../utils/constants';
import styles from './AdminNavbar.module.css';

const AdminNavbar = () => {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentLogo = theme === 'dark' ? darkmodeLogo : logo;

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const closeMenu = () => setMenuOpen(false);
  const openClassName = menuOpen ? styles['menu-open'] : '';

  return (
    <nav className={styles.navbar} aria-label="Admin">
      <div className={styles['navbar-container']}>
        <div className={styles['nav-left']}>
          <NavLink to="/" className={styles['back-btn']} aria-label="Home">
            <img src={currentLogo} alt="" className={styles['nav-logo']} />
          </NavLink>
          <NavLink to="/admin" end className={styles['nav-brand']} onClick={closeMenu}>
            {user?.role === USER_ROLES.ADMIN ? 'Admin Panel' : 'Staff Panel'}
          </NavLink>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          className={styles['menu-toggle']}
          aria-expanded={menuOpen}
          aria-controls="admin-navigation"
          onClick={() => setMenuOpen((isOpen) => !isOpen)}
        >
          {menuOpen ? 'Close menu' : 'Menu'}
        </button>

        <ul id="admin-navigation" className={`${styles['nav-links']} ${openClassName}`.trim()}>
          {user?.role === USER_ROLES.ADMIN && (
            <li>
              <NavLink to="/admin/users" onClick={closeMenu}>
                Users
              </NavLink>
            </li>
          )}
          {(user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.STAFF) && (
            <>
              <li>
                <NavLink to="/admin/problems" onClick={closeMenu}>
                  Problems
                </NavLink>
              </li>
              <li>
                <NavLink to="/admin/contests" onClick={closeMenu}>
                  Contests
                </NavLink>
              </li>
            </>
          )}
          {user?.role === USER_ROLES.ADMIN && (
            <li>
              <NavLink to="/admin/authoring" onClick={closeMenu}>
                Authoring
              </NavLink>
            </li>
          )}
          {user?.role === USER_ROLES.ADMIN && (
            <li>
              <NavLink to="/admin/settings" onClick={closeMenu}>
                Settings
              </NavLink>
            </li>
          )}
        </ul>

        <div
          className={`${styles['nav-actions']} ${openClassName}`.trim()}
          role="group"
          aria-label={user ? `Signed in as ${user.username}` : 'Account actions'}
        >
          {user && <span className={styles.username}>{user.username}</span>}
          <ThemeToggleButton />
          {user && (
            <button
              type="button"
              onClick={() => void handleLogout()}
              className={styles['logout-btn']}
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </nav>
  );
};

export default AdminNavbar;
