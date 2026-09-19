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
jest.mock('../../features/admin/users/UserManagement', () => () => <div data-testid="user-management">UserManagement</div>);
jest.mock('../../features/admin/problems/ProblemManagement', () => () => <div data-testid="problem-management">ProblemManagement</div>);
jest.mock('../../features/admin/contests/ContestManagement', () => () => <div data-testid="contest-management">ContestManagement</div>);
jest.mock('../../features/admin/settings/Settings', () => () => <div data-testid="settings">Settings</div>);

describe('Admin Page', () => {
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

    it('displays admin panel and sections for admin user', async () => {
        (useAuth as jest.Mock).mockReturnValue({
            user: { id: 1, username: 'admin', role: 'admin' }, isLoading: false
        });

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Admin Panel')).toBeInTheDocument();
            expect(screen.getByTestId('user-management')).toBeInTheDocument();
            expect(screen.getByTestId('problem-management')).toBeInTheDocument();
            expect(screen.getByTestId('contest-management')).toBeInTheDocument();
            expect(screen.getByTestId('settings')).toBeInTheDocument();
        });
    });

    it('displays only staff sections for staff user', async () => {
        (useAuth as jest.Mock).mockReturnValue({
            user: { id: 2, username: 'staff', role: 'staff' }, isLoading: false
        });

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Admin Panel')).toBeInTheDocument();
            expect(screen.getByTestId('problem-management')).toBeInTheDocument();
            expect(screen.getByTestId('contest-management')).toBeInTheDocument();
            expect(screen.queryByTestId('user-management')).not.toBeInTheDocument();
            expect(screen.queryByTestId('settings')).not.toBeInTheDocument();
        });
    });

    it('displays nothing for regular user', async () => {
        (useAuth as jest.Mock).mockReturnValue({
            user: { id: 3, username: 'user', role: 'user' }, isLoading: false
        });

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Admin Panel')).toBeInTheDocument();
            expect(screen.queryByTestId('user-management')).not.toBeInTheDocument();
            expect(screen.queryByTestId('problem-management')).not.toBeInTheDocument();
            expect(screen.queryByTestId('contest-management')).not.toBeInTheDocument();
            expect(screen.queryByTestId('settings')).not.toBeInTheDocument();
        });
    });
});
