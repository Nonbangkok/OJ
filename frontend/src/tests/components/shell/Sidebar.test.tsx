import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../../components/shell/Sidebar';
import { useAuth } from '../../../context/AuthContext';
import { useSettings } from '../../../context/SettingsContext';
import { useLiveContest } from '../../../components/shell/useLiveContest';
import type { Contest } from '../../../types';

jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../context/SettingsContext', () => ({ useSettings: jest.fn() }));
jest.mock('../../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }) }));
jest.mock('../../../components/shell/useLiveContest', () => ({ useLiveContest: jest.fn() }));

const asUser = (role: 'user' | 'staff' | 'admin' | null) =>
  jest.mocked(useAuth).mockReturnValue({
    user: role ? { id: 1, username: 'nattapat', role, hasAvatar: false, level: 12, tier: 'Expert' } : null,
    isLoading: false, login: jest.fn(), logout: jest.fn(), refreshUser: jest.fn(),
  } as ReturnType<typeof useAuth>);

const renderAt = (path = '/problems', props: Partial<React.ComponentProps<typeof Sidebar>> = {}) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar onCollapse={jest.fn()} onOpenSearch={jest.fn()} {...props} />
    </MemoryRouter>,
  );

describe('Sidebar', () => {
  beforeEach(() => {
    jest.mocked(useSettings).mockReturnValue({ isPrivateMode: false, registrationEnabled: true, passwordChangeEnabled: true } as ReturnType<typeof useSettings>);
    jest.mocked(useLiveContest).mockReturnValue(null);
  });

  it('is the main navigation and marks the current page', () => {
    asUser('user');
    renderAt('/problems');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /problems/i })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByText('Manage')).toBeNull();
  });

  it('the brand reads Grader 2.0 and links home', () => {
    asUser('user');
    renderAt('/problems');
    expect(screen.getByRole('link', { name: /Grader 2\.0/ })).toHaveAttribute('href', '/');
  });

  it('follows a role change without remounting', () => {
    asUser('user');
    const { rerender } = renderAt('/');
    expect(screen.queryByText('Manage')).toBeNull();
    asUser('staff');
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar onCollapse={jest.fn()} onOpenSearch={jest.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Manage')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /authoring/i })).toBeInTheDocument();
  });

  it('pins the live contest with its countdown', () => {
    asUser('user');
    jest.mocked(useLiveContest).mockReturnValue({
      id: 7, title: 'Midterm Practice', description: null, status: 'running',
      start_time: new Date(Date.now() - 60_000).toISOString(), end_time: new Date(Date.now() + 3_600_000).toISOString(),
    } as Contest);
    renderAt('/');
    const link = screen.getByRole('link', { name: /midterm practice/i });
    expect(link).toHaveAttribute('href', '/contests/7');
    expect(link).toHaveTextContent(/\d\d:\d\d/);
  });

  it('opens search and collapses from its controls', () => {
    asUser('user');
    const onOpenSearch = jest.fn();
    const onCollapse = jest.fn();
    renderAt('/', { onOpenSearch, onCollapse });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('offers log in to guests, and create account only when registration is open', () => {
    asUser(null);
    jest.mocked(useSettings).mockReturnValue({ isPrivateMode: false, registrationEnabled: false, passwordChangeEnabled: true } as ReturnType<typeof useSettings>);
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull();
  });
});
