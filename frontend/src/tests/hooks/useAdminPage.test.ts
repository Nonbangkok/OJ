import { renderHook, waitFor } from '@testing-library/react';
import useAdminPage from '../../hooks/useAdminPage';
import authService from '../../services/authService';

jest.mock('../../services/authService');

describe('useAdminPage', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('initializes with loading state and handles successful auth', async () => {
        const mockUser = { id: 1, username: 'admin', role: 'admin' };
        authService.checkLogin.mockResolvedValueOnce({ isAuthenticated: true, user: mockUser });

        const { result } = renderHook(() => useAdminPage());

        expect(result.current.loading).toBe(true);
        expect(result.current.user).toBeNull();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.user).toEqual(mockUser);
        expect(authService.checkLogin).toHaveBeenCalledTimes(1);
    });

    it('handles failed auth (not authenticated)', async () => {
        authService.checkLogin.mockResolvedValueOnce({ isAuthenticated: false });

        const { result } = renderHook(() => useAdminPage());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.user).toBeNull();
    });

    it('handles auth service error', async () => {
        authService.checkLogin.mockRejectedValueOnce(new Error('Network Error'));

        const { result } = renderHook(() => useAdminPage());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.user).toBeNull();
        // console.error is mocked in setupTests.js globally so we don't mock it here
        expect(console.error).toHaveBeenCalledWith('Could not fetch user data for admin panel', expect.any(Error));
    });
});
