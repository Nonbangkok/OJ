import { Link, NavLink } from 'react-router-dom';
import { FlagCheckered, MagnifyingGlass, SidebarSimple } from '@phosphor-icons/react';
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
}

const GROUP_TITLES: Record<NavItem['group'], string | null> = {
  practice: null,
  contests: 'Contests',
  manage: 'Manage',
};

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.to === '/' || item.to === '/admin'} className={styles.item}>
      <Icon size={17} aria-hidden="true" />
      <span className={styles.label}>{item.label}</span>
    </NavLink>
  );
}

function LiveContestLink({ id, title, endTime }: { id: number; title: string; endTime: string }) {
  const { label } = useCountdown(endTime);
  // Sidebar shows hours:minutes; the contest sidebar shows the full clock.
  const short = label.includes('d') ? label : label.slice(0, 5);
  return (
    <NavLink to={`/contests/${id}`} className={styles.item}>
      <FlagCheckered size={17} aria-hidden="true" />
      <span className={styles.label}>{title}</span>
      <span className={styles.live}>{short}</span>
    </NavLink>
  );
}

export default function Sidebar({ onCollapse, onOpenSearch }: SidebarProps) {
  const { user } = useAuth();
  const { isPrivateMode, registrationEnabled } = useSettings();
  const live = useLiveContest();
  const items = navItemsFor(user?.role ?? null, { privateMode: isPrivateMode });
  const groups = (['practice', 'contests', 'manage'] as const)
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter(({ group, items: groupItems }) => groupItems.length > 0 || (group === 'contests' && live));

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Link to="/" className={styles.brandLink}>
          <GraderLogo size={24} title="" />
          <span>Grader</span>
        </Link>
        <button type="button" className={styles.iconButton} aria-label="Collapse sidebar" onClick={onCollapse}>
          <SidebarSimple size={17} aria-hidden="true" />
        </button>
      </div>

      <button type="button" className={styles.search} onClick={onOpenSearch}>
        <MagnifyingGlass size={15} aria-hidden="true" />
        <span>Search</span>
        <kbd className={styles.kbd} aria-hidden="true">⌘K</kbd>
      </button>

      <nav aria-label="Main" className={styles.nav}>
        {groups.map(({ group, items: groupItems }) => (
          <div key={group} className={styles.group}>
            {GROUP_TITLES[group] && <div className={styles.groupTitle}>{GROUP_TITLES[group]}</div>}
            {group === 'contests' && live && (
              <LiveContestLink id={live.id} title={live.title} endTime={live.end_time} />
            )}
            {groupItems.map((item) => <NavItemLink key={item.key} item={item} />)}
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        {user ? (
          <AccountMenu />
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
