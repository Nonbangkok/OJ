import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Admin from '../../pages/admin/Admin';
import { useAuth } from '../../context/AuthContext';

jest.mock('../../context/AuthContext', () => ({
    useAuth: jest.fn(),
}));

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading...</div>);

describe('Admin Page (hub)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useAuth as jest.Mock).mockReturnValue({ user: null, isLoading: false });
    });

    it('displays loading state initially', () => {
        (useAuth as jest.Mock).mockReturnValue({ user: null, isLoading: true });

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading\.\.\.$/i)).toBeInTheDocument();
    });

    it('shows every section card for an admin, linking to the real admin routes', async () => {
        (useAuth as jest.Mock).mockReturnValue({
            user: { id: 1, username: 'admin', role: 'admin', hasAvatar: false }, isLoading: false
        });

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Admin Panel' })).toBeInTheDocument();
        });

        const nav = screen.getByRole('navigation', { name: 'Admin sections' });
        const links = Array.from(nav.querySelectorAll('a'));

        // All six sections, in display order, pointing at the existing routes.
        expect(links.map(a => [a.textContent, a.getAttribute('href')])).toEqual([
            ['Users→Manage users, roles, and account access.', '/admin/users'],
            ['Problems→Manage problems, visibility, uploads, and editing.', '/admin/problems'],
            ['Contests→Create and manage contests.', '/admin/contests'],
            ['Authoring→Create drafts, statements, testcases, solutions, and publish problems.', '/admin/authoring'],
            ['Analysis→View statistics and judge data.', '/admin/analysis'],
            ['Settings→Configure admin and system options.', '/admin/settings'],
        ]);
    });

    it('hides the admin-only sections (Users, Settings) from staff', async () => {
        (useAuth as jest.Mock).mockReturnValue({
            user: { id: 2, username: 'staff', role: 'staff', hasAvatar: false }, isLoading: false
        });

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Admin Panel' })).toBeInTheDocument();
        });

        const nav = screen.getByRole('navigation', { name: 'Admin sections' });
        expect(nav.querySelector('a[href="/admin/users"]')).toBeNull();
        expect(nav.querySelector('a[href="/admin/settings"]')).toBeNull();
        expect(nav.querySelector('a[href="/admin/problems"]')).not.toBeNull();
        expect(nav.querySelector('a[href="/admin/authoring"]')).not.toBeNull();
    });

    it('shows no section cards for a regular user', async () => {
        (useAuth as jest.Mock).mockReturnValue({
            user: { id: 3, username: 'user', role: 'user', hasAvatar: false }, isLoading: false
        });

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Admin Panel' })).toBeInTheDocument();
        });

        expect(screen.queryByRole('navigation', { name: 'Admin sections' })?.querySelectorAll('a').length ?? 0).toBe(0);
    });
});
