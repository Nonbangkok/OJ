import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CaretDown,
  Gear,
  Moon,
  SignOut,
  Sun,
  UserCircle,
} from '@phosphor-icons/react';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

import styles from './NavbarUserMenu.module.css';

const NavbarUserMenu = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const close = () => setOpen(false);

  return (
    <div className={styles.root} ref={rootRef}>
      {/* Trigger identifies the user only — identity, no progression data.
          Tier/level live in the dropdown header below. */}
      <button
        type="button"
        className={styles.trigger}
        aria-label="Open user menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {user.hasAvatar ? (
          <img
            className={styles.avatar}
            src={`${process.env.REACT_APP_API_URL}/users/${user.username}/avatar`}
            alt={`${user.username}'s avatar`}
          />
        ) : (
          <span className={`${styles.avatar} ${styles['avatar-fallback']}`} aria-hidden="true">
            {user.username[0]?.toLocaleUpperCase()}
          </span>
        )}
        <span className={styles.username} title={user.username}>{user.username}</span>
        <CaretDown size={12} weight="bold" className={styles.caret} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {/* Header: identity + compact progression. Secondary text only —
              no badges, no gamification. */}
          <div className={styles['menu-header']}>
            <div className={styles['menu-header-identity']}>
              {user.hasAvatar ? (
                <img
                  className={styles['header-avatar']}
                  src={`${process.env.REACT_APP_API_URL}/users/${user.username}/avatar`}
                  alt=""
                />
              ) : (
                <span className={`${styles['header-avatar']} ${styles['avatar-fallback']}`} aria-hidden="true">
                  {user.username[0]?.toLocaleUpperCase()}
                </span>
              )}
              <span className={styles['header-names']}>
                <span className={styles['header-username']}>{user.username}</span>
                {user.tier && (
                  <span className={styles['header-tier']}>
                    {user.tier}{user.level != null ? ` · Level ${user.level}` : ''}
                  </span>
                )}
              </span>
            </div>
          </div>

          <Link to={`/profile/${user.username}`} role="menuitem" className={styles['menu-item']} onClick={close}>
            <UserCircle size={16} aria-hidden="true" />
            My Profile
          </Link>
          {(user.role === 'admin' || user.role === 'staff') && (
            <Link to="/admin/settings" role="menuitem" className={styles['menu-item']} onClick={close}>
              <Gear size={16} aria-hidden="true" />
              Settings
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles['menu-item']}
            onClick={() => {
              toggleTheme();
              close();
            }}
          >
            {theme === 'light' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>

          <div className={styles['menu-separator']} role="separator" />

          <button
            type="button"
            role="menuitem"
            className={styles['menu-item']}
            onClick={() => {
              close();
              logout();
            }}
          >
            <SignOut size={16} aria-hidden="true" />
            Log Out
          </button>
        </div>
      )}
    </div>
  );
};

export default NavbarUserMenu;
