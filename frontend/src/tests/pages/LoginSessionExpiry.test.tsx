import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Login from '../../pages/auth/Login';
import authService from '../../services/authService';

jest.mock('../../services/authService');
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        login: jest.fn()
    })
}));
jest.mock('../../context/SettingsContext', () => ({
    useSettings: () => ({
        registrationEnabled: true,
        accessMode: 'public',
        isPrivateMode: false,
        isLoading: false
    })
}));

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useNavigate: () => mockNavigate,
}));

describe('Login page session-expiry handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.history.replaceState({}, '', '/');
    });

    it('shows an expiry notice when arriving with ?expired=1', () => {
        window.history.replaceState({}, '', '/login?expired=1');

        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    });

    it('does not show the expiry notice on a plain visit', () => {
        window.history.replaceState({}, '', '/login');

        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
    });

    it('returns the user to the page they were on after login', async () => {
        window.history.replaceState({}, '', '/login?expired=1&returnTo=%2Fproblems%2Fabc');
        jest.mocked(authService.login).mockResolvedValueOnce({
            message: 'Logged in',
            user: { id: 1, username: 'testuser', role: 'user', hasAvatar: false }
        });

        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'testuser' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: /login/i }));

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/problems/abc');
        });
    });

    it('falls back to the homepage when no returnTo is present', async () => {
        window.history.replaceState({}, '', '/login?expired=1');
        jest.mocked(authService.login).mockResolvedValueOnce({
            message: 'Logged in',
            user: { id: 1, username: 'testuser', role: 'user', hasAvatar: false }
        });

        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'testuser' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: /login/i }));

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });
    });
});
