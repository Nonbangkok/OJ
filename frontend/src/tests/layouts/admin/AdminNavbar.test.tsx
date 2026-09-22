import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../../context/AuthContext';
import { useTheme } from '../../../context/ThemeContext';
import AdminNavbar from '../../../layouts/admin/AdminNavbar';
import { USER_ROLES } from '../../../utils/constants';

jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../context/ThemeContext', () => ({ useTheme: jest.fn() }));
jest.mock('../../../assets/logo512.png', () => 'light-logo');
jest.mock('../../../assets/logo512_darkmode.png', () => 'dark-logo');

const mockLogout = jest.fn(() => Promise.resolve());

const NavbarHarness = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <AdminNavbar />
      <button type="button" onClick={() => navigate('/admin/contests')}>
        Change route
      </button>
      <output aria-label="Current route">{location.pathname}</output>
    </>
  );
};

const renderNavbar = (
  role: (typeof USER_ROLES)[keyof typeof USER_ROLES] = USER_ROLES.ADMIN,
  path = '/admin'
) => {
  jest.mocked(useAuth).mockReturnValue({
    user: { id: 1, username: `${role}-user`, role, hasAvatar: false },
    isLoading: false,
    login: jest.fn(),
    logout: mockLogout,
  });

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<h1>Home</h1>} />
        <Route path="*" element={<NavbarHarness />} />
      </Routes>
    </MemoryRouter>
  );
};

describe('AdminNavbar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
    jest.mocked(useTheme).mockReturnValue({ theme: 'light', toggleTheme: jest.fn() });
  });

  it('shows every administration link to administrators', () => {
    renderNavbar();

    const navigation = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(navigation).getByRole('link', { name: 'Admin Panel' })).toHaveAttribute(
      'href',
      '/admin'
    );
    expect(within(navigation).getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/admin/users'
    );
    expect(within(navigation).getByRole('link', { name: 'Problems' })).toHaveAttribute(
      'href',
      '/admin/problems'
    );
    expect(within(navigation).getByRole('link', { name: 'Contests' })).toHaveAttribute(
      'href',
      '/admin/contests'
    );
    expect(within(navigation).getByRole('link', { name: 'Authoring' })).toHaveAttribute(
      'href',
      '/admin/authoring'
    );
    expect(within(navigation).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/admin/settings'
    );
  });

  it('shows only the permitted navigation links to staff', () => {
    renderNavbar(USER_ROLES.STAFF);

    const navigation = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(navigation).getByRole('link', { name: 'Staff Panel' })).toBeInTheDocument();
    expect(within(navigation).getByRole('link', { name: 'Problems' })).toBeInTheDocument();
    expect(within(navigation).getByRole('link', { name: 'Contests' })).toBeInTheDocument();
    expect(within(navigation).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    // Staff author problems too, so Authoring stays visible to them.
    expect(within(navigation).getByRole('link', { name: 'Authoring' })).toBeInTheDocument();
    expect(within(navigation).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Signed in as staff-user' })).toBeInTheDocument();
  });

  it('exposes a collapsed menu button that identifies the controlled navigation', () => {
    renderNavbar();

    const menuButton = screen.getByRole('button', { name: 'Menu' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton).toHaveAttribute('aria-controls', 'admin-navigation');
    expect(screen.getByRole('list')).toHaveAttribute('id', 'admin-navigation');
  });

  it('opens and closes the menu from the toggle', () => {
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const closeButton = screen.getByRole('button', { name: 'Close menu' });
    expect(closeButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(closeButton);
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu when a navigation link is selected', () => {
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('link', { name: 'Problems' }));

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/admin/problems');
  });

  it('closes the menu on Escape and returns focus to the menu button', () => {
    renderNavbar();

    const menuButton = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menuButton);
    screen.getByRole('button', { name: 'Change route' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton).toHaveFocus();
  });

  it('closes the menu when the route changes elsewhere', async () => {
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change route' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
    );
  });

  it('logs out through the user menu', async () => {
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it('marks the active route without requiring pointer interaction', () => {
    renderNavbar(USER_ROLES.ADMIN, '/admin/problems');

    expect(screen.getByRole('link', { name: 'Problems' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Users' })).not.toHaveAttribute('aria-current');
  });
});
