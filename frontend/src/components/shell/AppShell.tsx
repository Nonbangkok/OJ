import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MagnifyingGlass, SidebarSimple } from '@phosphor-icons/react';
import GraderLogo from '../brand/GraderLogo';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import Sidebar from './Sidebar';
import MobileTabBar from './MobileTabBar';
import { navItemsFor } from './navItems';
import { isEditableTarget, isModalOpen } from './keyboard';
import { useCommandPalette } from './CommandPaletteContext';
import styles from './AppShell.module.css';

const STORAGE_KEY = 'oj.sidebar.collapsed';

const readPreference = (): boolean | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === null ? null : value === 'true';
  } catch {
    return null;
  }
};

const writePreference = (value: boolean) => {
  try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* storage unavailable */ }
};

export interface AppShellProps {
  children: ReactNode;
  onOpenSearch?: () => void;
}

export default function AppShell({ children, onOpenSearch: onOpenSearchProp }: AppShellProps) {
  const palette = useCommandPalette();
  const onOpenSearch = onOpenSearchProp ?? palette.open;
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { isPrivateMode } = useSettings();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [preference, setPreference] = useState<boolean | null>(readPreference);

  // The §10 interim rule (collapse on pages with their own left rail) is retired:
  // phase 6 removed the last rail, the authoring workspace's.
  const collapsed = preference ?? false;

  const toggle = () => {
    setPreference(!collapsed);
    writePreference(!collapsed);
  };

  useEffect(() => {
    if (isMobile) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || isModalOpen()) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const items = navItemsFor(user?.role ?? null, { privateMode: isPrivateMode });

  if (isMobile) {
    return (
      <div className={styles.mobile}>
        <header className={styles.topbar}>
          <Link to="/" className={styles.brand} aria-label="Grader home"><GraderLogo size={24} title="" /></Link>
          <button type="button" className={styles.iconButton} aria-label="Search" onClick={onOpenSearch}>
            <MagnifyingGlass size={19} aria-hidden="true" />
          </button>
        </header>
        <main className={styles.main}>{children}</main>
        <MobileTabBar items={items} />
      </div>
    );
  }

  return (
    <div className={collapsed ? `${styles.shell} ${styles.collapsed}` : styles.shell}>
      {collapsed ? (
        <header className={styles.strip}>
          <Link to="/" className={styles.brand} aria-label="Grader home"><GraderLogo size={22} title="" /></Link>
          <button type="button" className={styles.iconButton} aria-label="Expand sidebar" onClick={toggle}>
            <SidebarSimple size={17} aria-hidden="true" />
          </button>
          <button type="button" className={styles.iconButton} aria-label="Search" onClick={onOpenSearch}>
            <MagnifyingGlass size={17} aria-hidden="true" />
          </button>
        </header>
      ) : (
        <Sidebar onCollapse={toggle} onOpenSearch={onOpenSearch} />
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
