import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MagnifyingGlass } from '@phosphor-icons/react';
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
const WIDTH_KEY = 'oj.sidebar.width';
/** Sidebar width bounds (px). Dragging narrower than COLLAPSE_AT turns it into the icon rail. */
export const SIDEBAR = { DEFAULT: 220, MIN: 180, MAX: 360, RAIL: 60, COLLAPSE_AT: 120, STEP: 16 } as const;

const clampWidth = (value: number) => Math.round(Math.min(SIDEBAR.MAX, Math.max(SIDEBAR.MIN, value)));
const readWidth = (): number => {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? clampWidth(value) : SIDEBAR.DEFAULT;
  } catch {
    return SIDEBAR.DEFAULT;
  }
};
const writeWidth = (value: number) => {
  try { localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* storage unavailable */ }
};

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
  const [width, setWidth] = useState(readWidth);

  const setCollapsed = (next: boolean) => {
    setPreference(next);
    writePreference(next);
  };
  const toggle = () => setCollapsed(!collapsed);
  const resizeTo = (next: number) => {
    const value = clampWidth(next);
    setWidth(value);
    writeWidth(value);
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

  const shellStyle = { '--sidebar-current': `${collapsed ? SIDEBAR.RAIL : width}px` } as CSSProperties;
  return (
    <div className={styles.shell} style={shellStyle}>
      <div className={styles.sidebarSlot}>
        <Sidebar compact={collapsed} onCollapse={toggle} onOpenSearch={onOpenSearch} />
        <SidebarResizer
          width={width}
          collapsed={collapsed}
          onResize={(next) => { if (collapsed) setCollapsed(false); resizeTo(next); }}
          onCollapse={() => { if (!collapsed) setCollapsed(true); }}
          onReset={() => { setCollapsed(false); resizeTo(SIDEBAR.DEFAULT); }}
        />
      </div>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

/**
 * The sidebar's right edge: drag (or arrow keys) to change its width. Narrower
 * than SIDEBAR.COLLAPSE_AT it becomes the icon rail; double-click resets.
 */
function SidebarResizer({ width, collapsed, onResize, onCollapse, onReset }: {
  width: number; collapsed: boolean;
  onResize: (width: number) => void; onCollapse: () => void; onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  // Latest handlers for the window listeners attached while dragging.
  const handlers = useRef({ onResize, onCollapse });
  useEffect(() => { handlers.current = { onResize, onCollapse }; });

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event: MouseEvent) => {
      if (event.clientX < SIDEBAR.COLLAPSE_AT) handlers.current.onCollapse();
      else handlers.current.onResize(event.clientX);
    };
    const stop = () => setDragging(false);
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [dragging]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowRight') onResize(collapsed ? SIDEBAR.MIN : width + SIDEBAR.STEP);
    else if (event.key === 'ArrowLeft') {
      if (collapsed) return;
      if (width - SIDEBAR.STEP < SIDEBAR.MIN) onCollapse(); else onResize(width - SIDEBAR.STEP);
    } else if (event.key === 'Home') onCollapse();
    else if (event.key === 'End') onResize(SIDEBAR.MAX);
    else return;
    event.preventDefault();
  };

  return (
    // A focusable separator with a value is the WAI-ARIA window-splitter pattern: interactive by definition.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR.RAIL}
      aria-valuemax={SIDEBAR.MAX}
      aria-valuenow={collapsed ? SIDEBAR.RAIL : width}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see above
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={dragging ? `${styles.resizer} ${styles.resizing}` : styles.resizer}
      onPointerDown={(event) => { if (event.button > 0) return; event.preventDefault(); setDragging(true); }}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
