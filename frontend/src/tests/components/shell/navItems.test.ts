import { navItemsFor } from '../../../components/shell/navItems';

const keys = (role: Parameters<typeof navItemsFor>[0], privateMode = false, group = 'manage') =>
  navItemsFor(role, { privateMode }).filter((i) => i.group === group).map((i) => i.key);

describe('navItemsFor', () => {
  it('gives students no manage items', () => {
    expect(keys('user')).toEqual([]);
    expect(keys('user', false, 'practice')).toEqual(['home', 'problems', 'submissions', 'ranking']);
  });

  it('gives staff problems, contests, analysis and authoring', () => {
    expect(keys('staff')).toEqual(['manage-problems', 'manage-contests', 'manage-analysis', 'manage-authoring']);
  });

  it('gives admins every manage page', () => {
    expect(keys('admin')).toEqual([
      'manage-users', 'manage-problems', 'manage-contests', 'manage-analysis', 'manage-authoring', 'manage-settings',
    ]);
  });

  it('shows guests only public pages', () => {
    expect(navItemsFor(null, { privateMode: false }).map((i) => i.key)).toEqual(['home', 'problems']);
    expect(navItemsFor(null, { privateMode: true })).toEqual([]);
  });
});
