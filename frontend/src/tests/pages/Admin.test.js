import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Admin from '../../pages/admin/Admin';
import authService from '../../services/authService';

jest.mock('../../services/authService');
jest.mock('../../features/admin/users/UserManagement', () => () => <div data-testid="user-management">UserManagement</div>);
jest.mock('../../features/admin/problems/ProblemManagement', () => () => <div data-testid="problem-management">ProblemManagement</div>);
jest.mock('../../features/admin/contests/ContestManagement', () => () => <div data-testid="contest-management">ContestManagement</div>);
jest.mock('../../features/admin/settings/Settings', () => () => <div data-testid="settings">Settings</div>);

describe('Admin Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('displays loading state initially', () => {
        authService.checkLogin.mockReturnValue(new Promise(() => { }));

        render(
            <BrowserRouter>
                <Admin />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('displays admin panel and sections for admin user', async () => {
        authService.checkLogin.mockResolvedValueOnce({
            isAuthenticated: true, user: { username: 'admin', role: 'admin' }
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
        authService.checkLogin.mockResolvedValueOnce({
            isAuthenticated: true, user: { username: 'staff', role: 'staff' }
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
        authService.checkLogin.mockResolvedValueOnce({
            isAuthenticated: true, user: { username: 'user', role: 'user' }
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
