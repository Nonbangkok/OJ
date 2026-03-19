import { renderHook, waitFor, act } from '@testing-library/react';
import useUserManagement from '../../../hooks/admin/useUserManagement';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useUserManagement', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockUsers = [
        { id: 1, username: 'admin1', role: 'admin' },
        { id: 2, username: 'user1', role: 'user' }
    ];

    it('fetches users on mount', async () => {
        adminService.getUsers.mockResolvedValueOnce(mockUsers);

        const { result } = renderHook(() => useUserManagement());

        expect(result.current.loading).toBe(true);
        expect(result.current.users).toEqual([]);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.users).toEqual(mockUsers);
        expect(adminService.getUsers).toHaveBeenCalledTimes(1);
    });

    it('handles user deletion correctly', async () => {
        adminService.getUsers.mockResolvedValueOnce(mockUsers);

        // allow initial fetch
        const { result } = renderHook(() => useUserManagement());
        await waitFor(() => expect(result.current.loading).toBe(false));

        adminService.deleteUser.mockResolvedValueOnce({});

        act(() => {
            result.current.handleDeleteClick(mockUsers[1]);
        });

        expect(result.current.deletingUser).toEqual(mockUsers[1]);

        await act(async () => {
            await result.current.handleConfirmDelete();
        });

        expect(adminService.deleteUser).toHaveBeenCalledWith(2);
        expect(result.current.deletingUser).toBeNull();
        expect(result.current.users).toHaveLength(1);
        expect(result.current.users[0].id).toBe(1);
    });

    it('handles API errors during fetching', async () => {
        adminService.getUsers.mockRejectedValueOnce(new Error('Network Error'));

        const { result } = renderHook(() => useUserManagement());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Failed to fetch users.');
    });
});
