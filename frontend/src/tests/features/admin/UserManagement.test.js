import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import UserManagement from '../../../features/admin/users/UserManagement';
import adminService from '../../../services/adminService';
import { useAuth } from '../../../context/AuthContext';
import { BrowserRouter } from 'react-router-dom';
import { APP_CONSTANTS } from '../../../utils/constants';

// Mock services and context
jest.mock('../../../services/adminService');
jest.mock('../../../context/AuthContext');

const mockUsers = [
    { id: 1, username: 'Nonbangkok', role: 'admin' },
    { id: 2, username: 'user1', role: 'user' },
    { id: 3, username: 'staff1', role: 'staff' },
];

const mockCurrentUser = { id: 1, username: 'Nonbangkok', role: 'admin' };

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
        useAuth.mockReturnValue({ user: mockCurrentUser });
        adminService.getUsers.mockResolvedValue(mockUsers);
    });

    it('renders loading state initially', () => {
        adminService.getUsers.mockReturnValue(new Promise(() => { }));
        renderUserManagement();
        expect(screen.getByText(/loading users.../i)).toBeInTheDocument();
    });

    it('renders user list and headers correctly', async () => {
        renderUserManagement();

        await waitFor(() => {
            expect(screen.getByText('User Management')).toBeInTheDocument();
            expect(screen.getByText('user1')).toBeInTheDocument();
            expect(screen.getByText('staff1')).toBeInTheDocument();
        });
    });

    it('hides actions for protected users (self and system admin)', async () => {
        renderUserManagement();

        await waitFor(() => {
            const rows = screen.getAllByRole('row');

            // Row 1: Nonbangkok (System Admin/Self)
            const adminRow = rows.find(r => r.textContent.includes('Nonbangkok'));
            const adminActions = within(adminRow).queryAllByRole('button');
            expect(adminActions.length).toBe(0);

            // Row 2: user1 (Regular user)
            const userRow = rows.find(r => r.textContent.includes('user1'));
            const userActions = within(userRow).getAllByRole('button');
            expect(userActions.length).toBeGreaterThan(0);
            expect(within(userRow).getByText(/edit/i)).toBeInTheDocument();
            expect(within(userRow).getByText(/delete/i)).toBeInTheDocument();
        });
    });

    it('opens and closes AddUserModal', async () => {
        renderUserManagement();

        await waitFor(() => screen.getByText('Create New User'));
        fireEvent.click(screen.getByText('Create New User'));

        expect(screen.getByRole('heading', { name: /create new user/i })).toBeInTheDocument();

        fireEvent.click(screen.getByText(/cancel/i));
        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: /create new user/i })).not.toBeInTheDocument();
        });
    });

    it('calls deleteUser service when confirmed', async () => {
        adminService.deleteUser.mockResolvedValue({ message: 'Success' });
        renderUserManagement();

        await waitFor(() => screen.getByText('user1'));

        const userRow = screen.getAllByRole('row').find(r => r.textContent.includes('user1'));
        fireEvent.click(within(userRow).getByText(/delete/i));

        expect(screen.getByText(/confirm deletion/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

        await waitFor(() => {
            expect(adminService.deleteUser).toHaveBeenCalledWith(2);
        });
    });

    it('displays error message on service failure', async () => {
        adminService.getUsers.mockRejectedValue(new Error('Fetch failed'));
        renderUserManagement();

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch users/i)).toBeInTheDocument();
        });
    });
});
