import { Link, NavLink } from 'react-router-dom';
import { FlagCheckered, MagnifyingGlass, SidebarSimple, SignIn } from '@phosphor-icons/react';
import GraderLogo from '../brand/GraderLogo';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import AccountMenu from './AccountMenu';
import { navItemsFor, type NavItem } from './navItems';
import { useLiveContest } from './useLiveContest';
import { useCountdown } from './useCountdown';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  onCollapse: () => void;
  onOpenSearch: () => void;
  /** The icon rail: icons only, names as accessible labels and tooltips. */
  compact?: boolean;
}

const GROUP_TITLES: Record<NavItem['group'], string | null> = {
  practice: null,
  contests: 'Contests',
  manage: 'Manage',
};

function NavItemLink({ item, compact }: { item: NavItem; compact: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.to === '/' || item.to === '/admin'} className={styles.item}
      aria-label={compact ? item.label : undefined} title={compact ? item.label : undefined}>
      <Icon size={17} aria-hidden="true" />
      {!compact && <span className={styles.label}>{item.label}</span>}
    </NavLink>
  );
}

function LiveContestLink({ id, title, endTime, compact }: { id: number; title: string; endTime: string; compact: boolean }) {
  const { label } = useCountdown(endTime);
  // Sidebar shows hours:minutes; the contest sidebar shows the full clock.
  const short = label.includes('d') ? label : label.slice(0, 5);
  return (
    <NavLink to={`/contests/${id}`} className={styles.item}
      aria-label={compact ? `${title}, ends in ${short}` : undefined} title={compact ? `${title} · ${short}` : undefined}>
      <FlagCheckered size={17} aria-hidden="true" />
      {compact ? <span className={styles.liveDot} aria-hidden="true" /> : (
        <>
          <span className={styles.label}>{title}</span>
          <span className={styles.live}>{short}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar({ onCollapse, onOpenSearch, compact = false }: SidebarProps) {
  const { user } = useAuth();
  const { isPrivateMode, registrationEnabled } = useSettings();
  const live = useLiveContest();
  const items = navItemsFor(user?.role ?? null, { privateMode: isPrivateMode });
  const groups = (['practice', 'contests', 'manage'] as const)
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter(({ group, items: groupItems }) => groupItems.length > 0 || (group === 'contests' && live));

  return (
    <aside className={compact ? `${styles.sidebar} ${styles.compact}` : styles.sidebar} data-compact={compact || undefined}>
      <div className={styles.brand}>
        <Link to="/" className={styles.brandLink} aria-label={compact ? 'Grader home' : undefined}>
          <GraderLogo size={24} title="" />
          {!compact && <span>Grader 2.0</span>}
        </Link>
        <button type="button" className={styles.iconButton} aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
          title={compact ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'} onClick={onCollapse}>
          <SidebarSimple size={17} aria-hidden="true" />
        </button>
      </div>

      <button type="button" className={styles.search} onClick={onOpenSearch} aria-label={compact ? 'Search' : undefined} title={compact ? 'Search (⌘K)' : undefined}>
        <MagnifyingGlass size={15} aria-hidden="true" />
        {!compact && <span>Search</span>}
        {!compact && <kbd className={styles.kbd} aria-hidden="true">⌘K</kbd>}
      </button>

      <nav aria-label="Main" className={styles.nav}>
        {groups.map(({ group, items: groupItems }) => (
          <div key={group} className={styles.group}>
            {GROUP_TITLES[group] && (compact
              ? <div className={styles.groupRule} role="separator" aria-label={GROUP_TITLES[group] ?? undefined} />
              : <div className={styles.groupTitle}>{GROUP_TITLES[group]}</div>)}
            {group === 'contests' && live && (
              <LiveContestLink id={live.id} title={live.title} endTime={live.end_time} compact={compact} />
            )}
            {groupItems.map((item) => <NavItemLink key={item.key} item={item} compact={compact} />)}
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        {user ? (
          <AccountMenu compact={compact} />
        ) : compact ? (
          <Link to="/login" className={styles.item} aria-label="Log in" title="Log in"><SignIn size={17} aria-hidden="true" /></Link>
        ) : (
          <div className={styles.guestActions}>
            <Link to="/login" className={styles.primaryAction}>Log in</Link>
            {registrationEnabled && <Link to="/register" className={styles.secondaryAction}>Create account</Link>}
          </div>
        )}
      </div>
    </aside>
  );
}
