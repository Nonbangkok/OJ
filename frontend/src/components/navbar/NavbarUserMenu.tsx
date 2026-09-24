import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CaretDown,
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
        <span className={styles.username}>{user.username}</span>
        {user.tier && (
          <span className={styles['tier-badge']} title={`${user.tier} tier`}>
            {user.tier}
          </span>
        )}
        <CaretDown size={12} weight="bold" className={styles.caret} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <Link to={`/profile/${user.username}`} role="menuitem" className={styles['menu-item']} onClick={close}>
            <UserCircle size={16} aria-hidden="true" />
            My Profile
          </Link>
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
