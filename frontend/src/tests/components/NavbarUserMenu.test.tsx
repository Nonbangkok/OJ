import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NavbarUserMenu from '../../components/navbar/NavbarUserMenu';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

jest.mock('../../context/AuthContext');
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
        });
        renderMenu();

        const img = screen.getByAltText("tester's avatar");
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toContain('/users/tester/avatar');
    });
});
