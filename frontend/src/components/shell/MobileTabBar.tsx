import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { DotsThree } from '@phosphor-icons/react';
import { Drawer } from '../ui';
import { useAuth } from '../../context/AuthContext';
import AccountMenu from './AccountMenu';
import type { NavItem } from './navItems';
import styles from './MobileTabBar.module.css';

const PRIMARY = ['home', 'problems', 'contests', 'submissions'];

export interface MobileTabBarProps {
  items: NavItem[];
}

export default function MobileTabBar({ items }: MobileTabBarProps) {
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = PRIMARY.map((key) => items.find((item) => item.key === key)).filter((item): item is NavItem => Boolean(item));
  const rest = items.filter((item) => !PRIMARY.includes(item.key));

  return (
    <>
      <nav aria-label="Primary" className={styles.tabbar}>
        {primary.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.key} to={item.to} end={item.to === '/'} className={styles.tab}>
              <Icon size={20} aria-hidden="true" />
              <span>{item.key === 'contests' ? 'Contests' : item.label}</span>
            </NavLink>
          );
        })}
        <button type="button" className={styles.tab} onClick={() => setMoreOpen(true)}>
          <DotsThree size={20} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
      <Drawer open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <div className={styles.sheet}>
          {rest.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.key} to={item.to} className={styles.sheetItem} onClick={() => setMoreOpen(false)}>
                <Icon size={18} aria-hidden="true" />
                {item.group === 'manage' ? `Manage · ${item.label}` : item.label}
              </NavLink>
            );
          })}
          {user ? (
            <div className={styles.account}><AccountMenu /></div>
          ) : (
            <NavLink to="/login" className={styles.sheetItem} onClick={() => setMoreOpen(false)}>Log in</NavLink>
          )}
        </div>
      </Drawer>
    </>
  );
}
