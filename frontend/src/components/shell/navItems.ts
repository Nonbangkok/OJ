import type { Icon } from '@phosphor-icons/react';
import {
  Books, CalendarBlank, ChartLine, FlagBanner, GearSix, House, ListChecks, PaperPlaneTilt, PencilRuler, Ranking, Users,
} from '@phosphor-icons/react';
import type { UserRole } from '../../types';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: Icon;
  group: 'practice' | 'contests' | 'manage';
}

const PRACTICE: NavItem[] = [
  { key: 'home', label: 'Home', to: '/', icon: House, group: 'practice' },
  { key: 'problems', label: 'Problems', to: '/problems', icon: ListChecks, group: 'practice' },
  { key: 'submissions', label: 'Submissions', to: '/submissions', icon: PaperPlaneTilt, group: 'practice' },
  { key: 'ranking', label: 'Ranking', to: '/scoreboard', icon: Ranking, group: 'practice' },
];

const CONTESTS: NavItem[] = [
  { key: 'contests', label: 'All contests', to: '/contests', icon: CalendarBlank, group: 'contests' },
];

const MANAGE: Array<NavItem & { adminOnly?: boolean }> = [
  { key: 'manage-users', label: 'Users', to: '/admin/users', icon: Users, group: 'manage', adminOnly: true },
  { key: 'manage-problems', label: 'Problems', to: '/admin/problems', icon: Books, group: 'manage' },
  { key: 'manage-contests', label: 'Contests', to: '/admin/contests', icon: FlagBanner, group: 'manage' },
  { key: 'manage-analysis', label: 'Analysis', to: '/admin/analysis', icon: ChartLine, group: 'manage' },
  { key: 'manage-authoring', label: 'Authoring', to: '/admin/authoring', icon: PencilRuler, group: 'manage' },
  { key: 'manage-settings', label: 'Settings', to: '/admin/settings', icon: GearSix, group: 'manage', adminOnly: true },
];

/** Navigation destinations the current viewer may open. Permissions mirror the routes' guards. */
export function navItemsFor(role: UserRole | null, opts: { privateMode: boolean }): NavItem[] {
  if (!role) {
    // Public mode: every public page (the old navbar showed these to guests too).
    return opts.privateMode ? [] : [...PRACTICE, ...CONTESTS];
  }
  const manage = role === 'admin'
    ? MANAGE
    : role === 'staff' ? MANAGE.filter((item) => !item.adminOnly) : [];
  return [...PRACTICE, ...CONTESTS, ...manage.map(({ adminOnly: _adminOnly, ...item }) => item)];
}
