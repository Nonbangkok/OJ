import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NavbarUserMenu from '../../components/navbar/NavbarUserMenu';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useTheme } from '../../context/ThemeContext';

jest.mock('../../context/AuthContext');
jest.mock('../../context/SettingsContext');
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(),
}));

// Phosphor icons render as svg — keep tests on text labels and roles only.

const mockLogout = jest.fn();
const mockToggleTheme = jest.fn();

describe('NavbarUserMenu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'user', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: mockLogout,
            refreshUser: jest.fn(),
        });
        jest.mocked(useSettings).mockReturnValue({
            registrationEnabled: true,
            accessMode: 'public',
            passwordChangeEnabled: true,
            isPrivateMode: false,
            isLoading: false,
            refreshSettings: jest.fn(),
        });
        jest.mocked(useTheme).mockReturnValue({
            theme: 'light',
            toggleTheme: mockToggleTheme,
        });
    });

    const renderMenu = () =>
        render(
            <MemoryRouter>
                <NavbarUserMenu />
            </MemoryRouter>,
        );

    it('shows the username and an avatar trigger', () => {
        renderMenu();
        expect(screen.getByText('tester')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /open user menu/i })).toBeInTheDocument();
    });

    it('keeps the trigger identity-only: no tier text next to the username', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'user', hasAvatar: false, tier: 'Novice', level: 4 },
            isLoading: false,
            login: jest.fn(),
            logout: mockLogout,
            refreshUser: jest.fn(),
        });
        renderMenu();

        // The closed trigger shows the username but never the tier.
        expect(screen.getByText('tester')).toBeInTheDocument();
        expect(screen.queryByText('Novice')).not.toBeInTheDocument();
    });

    it('shows tier and level in the dropdown header once opened', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'user', hasAvatar: false, tier: 'Grandmaster', level: 40 },
            isLoading: false,
            login: jest.fn(),
            logout: mockLogout,
            refreshUser: jest.fn(),
        });
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

        expect(screen.getByText('Grandmaster · Level 40')).toBeInTheDocument();
        // Header repeats the username alongside the menu items.
        expect(screen.getAllByText('tester').length).toBeGreaterThanOrEqual(2);
    });

    it('omits the progression line in the dropdown when the user has no tier', () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

        expect(screen.queryByText(/· Level /)).not.toBeInTheDocument();
    });

    it('shows Settings only for staff and admins', () => {
        const regular = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));
        expect(screen.queryByRole('menuitem', { name: /settings/i })).not.toBeInTheDocument();
        regular.unmount();

        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'admin', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: mockLogout,
            refreshUser: jest.fn(),
        });
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));
        expect(screen.getByRole('menuitem', { name: /settings/i })).toHaveAttribute('href', '/admin/settings');
    });

    it('does not show menu items before clicking', () => {
        renderMenu();
        expect(screen.queryByRole('menuitem', { name: /log out/i })).not.toBeInTheDocument();
    });

    it('opens the menu with profile, theme, and logout items on click', () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

        expect(screen.getByRole('menuitem', { name: /my profile/i })).toHaveAttribute(
            'href',
            '/profile/tester',
        );
        expect(screen.getByRole('menuitem', { name: /dark mode/i })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
    });

    it('shows the opposite theme label depending on current theme', () => {
        jest.mocked(useTheme).mockReturnValue({ theme: 'dark', toggleTheme: mockToggleTheme });
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

        expect(screen.getByRole('menuitem', { name: /light mode/i })).toBeInTheDocument();
    });

    it('toggles the theme from the menu item', () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /dark mode/i }));

        expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });

    it('closes the menu after choosing logout and logs out', () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

        expect(mockLogout).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menuitem', { name: /log out/i })).not.toBeInTheDocument();
    });

    it('closes the menu on Escape', () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('menuitem', { name: /log out/i })).not.toBeInTheDocument();
    });

    it('closes the menu when clicking outside', () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));
        fireEvent.mouseDown(document.body);

        expect(screen.queryByRole('menuitem', { name: /log out/i })).not.toBeInTheDocument();
    });

    it('renders the avatar image when the user has one', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'user', hasAvatar: true },
            isLoading: false,
            login: jest.fn(),
            logout: mockLogout,
            refreshUser: jest.fn(),
        });
        renderMenu();

        const img = screen.getByAltText("tester's avatar");
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toContain('/users/tester/avatar');
    });

    it('opens the change-password dialog from the menu (AUTH-004)', () => {
        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

        const item = screen.getByRole('menuitem', { name: /change password/i });
        fireEvent.click(item);

        // The dialog takes over from the closed dropdown.
        expect(screen.queryByRole('menuitem', { name: /change password/i })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument();
        expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    });

    it('hides Change Password for a regular user when the setting is disabled', () => {
        jest.mocked(useSettings).mockReturnValue({
            registrationEnabled: true,
            accessMode: 'public',
            passwordChangeEnabled: false,
            isPrivateMode: false,
            isLoading: false,
            refreshSettings: jest.fn(),
        });

        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

        expect(screen.queryByRole('menuitem', { name: /change password/i })).not.toBeInTheDocument();
        // The rest of the menu is untouched.
        expect(screen.getByRole('menuitem', { name: /my profile/i })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
    });

    it('keeps Change Password for an admin when the setting is disabled', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 1, username: 'admin', role: 'admin', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: mockLogout,
            refreshUser: jest.fn(),
        });
        jest.mocked(useSettings).mockReturnValue({
            registrationEnabled: true,
            accessMode: 'public',
            passwordChangeEnabled: false,
            isPrivateMode: false,
            isLoading: false,
            refreshSettings: jest.fn(),
        });

        renderMenu();
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

        expect(screen.getByRole('menuitem', { name: /change password/i })).toBeInTheDocument();
    });
});
