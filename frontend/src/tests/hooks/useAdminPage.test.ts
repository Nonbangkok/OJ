import { renderHook } from '@testing-library/react';
import useAdminPage from '../../hooks/useAdminPage';
import { useAuth } from '../../context/AuthContext';
import authService from '../../services/authService';

jest.mock('../../services/authService');

const mockUseAuth = (user: object | null, isLoading: boolean): void => {
    jest.mocked(useAuth).mockReturnValue({ user, isLoading } as ReturnType<typeof useAuth>);
};

jest.mock('../../context/AuthContext', () => {
    const original = jest.requireActual('../../context/AuthContext');
    return { ...original, useAuth: jest.fn() };
});

describe('useAdminPage', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('exposes the loading session state while auth resolves', () => {
        mockUseAuth(null, true);

        const { result } = renderHook(() => useAdminPage());

        expect(result.current.loading).toBe(true);
        expect(result.current.user).toBeNull();
    });

    it('returns the session user from AuthContext (no extra /me request)', () => {
        const mockUser = { id: 1, username: 'admin', role: 'admin' };
        mockUseAuth(mockUser, false);

        const { result } = renderHook(() => useAdminPage());

        expect(result.current.loading).toBe(false);
        expect(result.current.user).toEqual(mockUser);
        expect(authService.checkLogin).not.toHaveBeenCalled();
    });

    it('returns a null user when unauthenticated', () => {
        mockUseAuth(null, false);

        const { result } = renderHook(() => useAdminPage());

        expect(result.current.loading).toBe(false);
        expect(result.current.user).toBeNull();
    });
});
