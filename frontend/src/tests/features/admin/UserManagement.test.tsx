import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import UserManagement from '../../../features/admin/users/UserManagement';
import adminService from '../../../services/adminService';
import { useAuth } from '../../../context/AuthContext';
import { BrowserRouter } from 'react-router-dom';
import { APP_CONSTANTS } from '../../../utils/constants';

// Mock services and context
jest.mock('../../../services/adminService');
jest.mock('../../../context/AuthContext');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../../components/shared/LoadingPage', () => () => <div>Loading Users...</div>);

const mockUsers = [
    { id: 1, username: 'Nonbangkok', role: 'admin' as const },
    { id: 2, username: 'user1', role: 'user' as const },
    { id: 3, username: 'staff1', role: 'staff' as const },
];

const mockCurrentUser = { id: 1, username: 'Nonbangkok', role: 'admin' as const };

const renderUserManagement = () => {
    return render(
        <BrowserRouter>
            <UserManagement />
        </BrowserRouter>
    );
};

describe('UserManagement Component', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(useAuth) as jest.Mock).mockReturnValue({ user: mockCurrentUser, isLoading: false, login: jest.fn(), logout: jest.fn() });
        (jest.mocked(adminService.getUsers) as jest.Mock).mockResolvedValue({
            users: mockUsers,
            total: mockUsers.length,
            page: 1,
            limit: 100,
        });
    });

    it('keeps the search toolbar mounted while the initial users request loads', () => {
        (jest.mocked(adminService.getUsers) as jest.Mock).mockReturnValue(new Promise(() => { }));
        renderUserManagement();
        expect(screen.getByRole('searchbox', { name: /search users/i })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/loading users/i);
    });

    it('renders user list and headers correctly', async () => {
        renderUserManagement();

        await waitFor(() => {
            expect(screen.getByText('User Management')).toBeInTheDocument();
            expect(screen.getByText('user1')).toBeInTheDocument();
            expect(screen.getByText('staff1')).toBeInTheDocument();
        });
    });

    it('searches users across the database instead of only the currently loaded page', async () => {
        const remoteMatch = { id: 119, username: 'user-1-19', role: 'user' as const };
        (jest.mocked(adminService.getUsers) as jest.Mock)
            .mockResolvedValueOnce({ users: mockUsers, total: 123, page: 1, limit: 100 })
            .mockResolvedValueOnce({
                users: [{ id: 120, username: 'last-page-user', role: 'user' as const }],
                total: 123,
                page: 2,
                limit: 100,
            })
            .mockResolvedValueOnce({ users: [remoteMatch], total: 1, page: 1, limit: 100 });

        renderUserManagement();
        await screen.findByText('user1');
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(await screen.findByText('last-page-user')).toBeInTheDocument();

        const search = await screen.findByRole('searchbox', { name: /search users/i });
        search.focus();
        fireEvent.change(search, { target: { value: '1-19' } });

        expect(await screen.findByText('user-1-19')).toBeInTheDocument();
        expect(search).toHaveFocus();
        expect(adminService.getUsers).toHaveBeenLastCalledWith({
            page: 1,
            limit: 100,
            search: '1-19',
            role: 'all',
        });
    });

    it('hides actions for protected users (self and system admin)', async () => {
        renderUserManagement();

        await waitFor(() => {
            const rows = screen.getAllByRole('row');

            // Row 1: Nonbangkok (System Admin/Self) — every action disabled.
            const adminRow = rows.find(r => r.textContent.includes('Nonbangkok'));
            const adminEdit = within(adminRow).getByRole('button', { name: /^edit$/i });
            expect(adminEdit).toBeDisabled();

            // Row 2: user1 (Regular user) — Edit enabled, Delete reachable
            // through the overflow menu.
            const userRow = rows.find(r => r.textContent.includes('user1'));
            const userEdit = within(userRow).getByRole('button', { name: /^edit$/i });
            expect(userEdit).toBeEnabled();
        });
    });

    it('allows admins to lock a regular user and refreshes the row after confirmation', async () => {
        (jest.mocked(adminService.setUserSubmissionLock) as jest.Mock).mockResolvedValue({
            id: 2, username: 'user1', role: 'user', submissions_locked: true,
        });
        (jest.mocked(adminService.getUsers) as jest.Mock)
            .mockResolvedValueOnce({ users: mockUsers, total: mockUsers.length, page: 1, limit: 100 })
            .mockResolvedValueOnce({
                users: [mockUsers[0], { ...mockUsers[1], submissions_locked: true }, mockUsers[2]],
                total: mockUsers.length, page: 1, limit: 100,
            });
        renderUserManagement();
        await screen.findByText('user1');
        const userRow = screen.getAllByRole('row').find(r => r.textContent.includes('user1'));
        fireEvent.click(within(userRow).getByRole('button', { name: /row actions for user1/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /lock submissions/i }));
        expect(screen.getByText(/prevent this user from submitting and joining contests/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^lock$/i }));
        await waitFor(() => expect(adminService.setUserSubmissionLock).toHaveBeenCalledWith(2, true));
        expect(await screen.findByText(/submissions locked/i)).toBeInTheDocument();
    });

    it('selects displayed rows, confirms one bulk request, and reports skipped accounts', async () => {
        (jest.mocked(adminService.setUsersSubmissionLock) as jest.Mock).mockResolvedValue({
            updatedIds: [2], skippedIds: [1, 3],
        });
        renderUserManagement();
        await screen.findByText('user1');
        fireEvent.click(screen.getByRole('checkbox', { name: /select displayed users/i }));
        expect(screen.getByRole('checkbox', { name: /select user1/i })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /select staff1/i })).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: /^lock selected$/i }));
        expect(screen.getByText(/lock 3 selected users/i)).toBeInTheDocument();
        expect(adminService.setUsersSubmissionLock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /^lock$/i }));
        await waitFor(() => expect(adminService.setUsersSubmissionLock).toHaveBeenCalledWith([1, 2, 3], true));
        expect(adminService.setUsersSubmissionLock).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole('status')).toHaveTextContent(/updated 1 user.*skipped 2.*1, 3/i);
        expect(screen.getByRole('checkbox', { name: /select user1/i })).not.toBeChecked();
    });

    it('keeps bulk selection on the displayed page and clears it when the page changes', async () => {
        (jest.mocked(adminService.getUsers) as jest.Mock)
            .mockResolvedValueOnce({ users: mockUsers, total: 101, page: 1, limit: 100 })
            .mockResolvedValueOnce({ users: [{ id: 101, username: 'page2', role: 'user' }], total: 101, page: 2, limit: 100 });
        renderUserManagement();
        await screen.findByText('user1');
        fireEvent.click(screen.getByRole('checkbox', { name: /select user1/i }));
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
        await screen.findByText('page2');
        expect(screen.getByRole('checkbox', { name: /select page2/i })).not.toBeChecked();
        expect(screen.getByRole('button', { name: /^lock selected$/i })).toBeDisabled();
    });

    it('reports a failed bulk request and retains selection for retry', async () => {
        (jest.mocked(adminService.setUsersSubmissionLock) as jest.Mock).mockRejectedValue(new Error('Network error'));
        renderUserManagement();
        await screen.findByText('user1');
        fireEvent.click(screen.getByRole('checkbox', { name: /select user1/i }));
        fireEvent.click(screen.getByRole('button', { name: /unlock selected/i }));
        fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/failed to update selected users/i);
        expect(screen.getByRole('checkbox', { name: /select user1/i })).toBeChecked();
    });

    it('opens and closes AddUserModal', async () => {
        renderUserManagement();

        await waitFor(() => screen.getByText('+ New User'));
        fireEvent.click(screen.getByText('+ New User'));

        expect(screen.getByRole('heading', { name: /create new user/i })).toBeInTheDocument();

        fireEvent.click(screen.getByText(/cancel/i));
        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: /create new user/i })).not.toBeInTheDocument();
        });
    });

    it('calls deleteUser service when confirmed', async () => {
        (jest.mocked(adminService.deleteUser) as jest.Mock).mockResolvedValue({ message: 'Success' });
        renderUserManagement();

        await waitFor(() => screen.getByText('user1'));

        const userRow = screen.getAllByRole('row').find(r => r.textContent.includes('user1'));
        fireEvent.click(within(userRow).getByRole('button', { name: /row actions for user1/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

        expect(screen.getByText(/confirm deletion/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

        await waitFor(() => {
            expect(adminService.deleteUser).toHaveBeenCalledWith(2);
        });
    });

    it('displays error message on service failure', async () => {
        (jest.mocked(adminService.getUsers) as jest.Mock).mockRejectedValue(new Error('Fetch failed'));
        renderUserManagement();

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch users/i)).toBeInTheDocument();
        });
    });

    it('opens the Reset Password modal from the row actions (AUTH-004)', async () => {
        renderUserManagement();

        await waitFor(() => screen.getByText('user1'));

        const userRow = screen.getAllByRole('row').find(r => r.textContent.includes('user1'));
        fireEvent.click(within(userRow).getByRole('button', { name: /row actions for user1/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));

        expect(
            screen.getByRole('heading', { name: 'Reset Password — user1' }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    });

    it('disables the Reset password action for protected users', async () => {
        renderUserManagement();

        await waitFor(() => screen.getByText('Nonbangkok'));

        const adminRow = screen.getAllByRole('row').find(r => r.textContent.includes('Nonbangkok'));
        fireEvent.click(within(adminRow).getByRole('button', { name: /row actions for Nonbangkok/i }));
        expect(
            screen.getByRole('menuitem', { name: 'Reset password' }),
        ).toBeDisabled();
    });
});
