import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from '@base-ui/react/menu';
import {
  Gear,
  Key,
  Moon,
  SignOut,
  Sun,
  UserCircle,
} from '@phosphor-icons/react';

import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useTheme } from '../../context/ThemeContext';
import ChangePasswordDialog from '../user/ChangePasswordDialog';
import { MENU_TRIGGER_GAP, MENU_VIEWPORT_MARGIN } from '../ui/ActionMenu';

import styles from './AccountMenu.module.css';

/**
 * Account menu on Base UI Menu. The popup is portaled to the body and placed
 * by the positioner (opens upward, shifts to stay on screen): rendered inside
 * the sidebar it overflowed the narrow column and gave it a sideways scrollbar.
 * `compact`: the sidebar's icon rail — the avatar alone (the name stays the accessible label).
 */
const AccountMenu = ({ compact = false }: { compact?: boolean }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { passwordChangeEnabled } = useSettings();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  if (!user) return null;

  return (
    <div className={styles.root}>
      <Menu.Root modal={false}>
        {/* Trigger identifies the user only — identity, no progression data.
            Tier/level live in the dropdown header below. */}
        <Menu.Trigger
          className={compact ? `${styles.trigger} ${styles.triggerCompact}` : styles.trigger}
          aria-label="Open user menu"
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
          {!compact && <span className={styles.username} title={user.username}>{user.username}</span>}
          {!compact && user.level != null && <span className={styles.level}>Lv.{user.level}</span>}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className={styles.positioner}
            side="top"
            align="start"
            sideOffset={MENU_TRIGGER_GAP}
            collisionPadding={MENU_VIEWPORT_MARGIN}
          >
            <Menu.Popup className={styles.menu}>
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

              <Menu.Item className={styles['menu-item']} render={<Link to={`/profile/${user.username}`} />}>
                <UserCircle size={16} aria-hidden="true" />
                My Profile
              </Menu.Item>
              {/* Admins keep self-service password change even when the setting
                  is off; user/staff lose it. */}
              {(passwordChangeEnabled || user.role === 'admin') && (
                <Menu.Item className={styles['menu-item']} onClick={() => setIsChangePasswordOpen(true)}>
                  <Key size={16} aria-hidden="true" />
                  Change Password
                </Menu.Item>
              )}
              {user.role === 'admin' && (
                <Menu.Item className={styles['menu-item']} render={<Link to="/admin/settings" />}>
                  <Gear size={16} aria-hidden="true" />
                  Settings
                </Menu.Item>
              )}
              <Menu.Item className={styles['menu-item']} onClick={toggleTheme}>
                {theme === 'light' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
                {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
              </Menu.Item>

              <Menu.Separator className={styles['menu-separator']} />

              <Menu.Item className={styles['menu-item']} onClick={() => { void logout(); }}>
                <SignOut size={16} aria-hidden="true" />
                Log Out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <ChangePasswordDialog
        open={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </div>
  );
};

export default AccountMenu;
