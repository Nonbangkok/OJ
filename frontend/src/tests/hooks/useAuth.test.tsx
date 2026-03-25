import { renderHook, act } from '@testing-library/react';
import { useAuth, AuthProvider } from '../../context/AuthContext';
import authService from '../../services/authService';

// Mock the entire authService module
jest.mock('../../services/authService', () => ({
    checkLogin: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    register: jest.fn(),
}));

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('useAuth Hook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('initializes and checks auth on mount', async () => {
        const mockUser = { username: 'testuser', role: 'user' };
        (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValueOnce({ isAuthenticated: true, user: mockUser });

        let result;
        await act(async () => {
            const rendered = renderHook(() => useAuth(), { wrapper });
            result = rendered.result;
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.user).toEqual(mockUser);
    });

    it('handles failed auth check on mount', async () => {
        (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValueOnce({ isAuthenticated: false });

        let result;
        await act(async () => {
            const rendered = renderHook(() => useAuth(), { wrapper });
            result = rendered.result;
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.user).toBe(null);
    });

    it('handles login successfully', async () => {
        (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValueOnce({ isAuthenticated: false });
        const mockUser = { username: 'loggeduser', role: 'admin' };

        let result;
        await act(async () => {
            const rendered = renderHook(() => useAuth(), { wrapper });
            result = rendered.result;
        });

        act(() => {
            result.current.login(mockUser);
        });

        expect(result.current.user).toEqual(mockUser);
    });

    it('handles logout successfully', async () => {
        const mockUser = { username: 'testuser', role: 'user' };
        (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValueOnce({ isAuthenticated: true, user: mockUser });
        (jest.mocked(authService.logout) as jest.Mock).mockResolvedValueOnce(undefined);

        let result;
        await act(async () => {
            const rendered = renderHook(() => useAuth(), { wrapper });
            result = rendered.result;
        });

        expect(result.current.user).toEqual(mockUser);

        await act(async () => {
            await result.current.logout();
        });

        expect(authService.logout).toHaveBeenCalledTimes(1);
        expect(result.current.user).toBe(null);
    });
});
