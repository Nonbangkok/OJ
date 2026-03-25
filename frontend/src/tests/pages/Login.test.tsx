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
        isLoading: false
    })
}));
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useNavigate: () => jest.fn()
}));

describe('Login Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders login form', () => {
        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );
        expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('submits credentials successfully', async () => {
        jest.mocked(authService.login).mockResolvedValueOnce({
            message: 'Logged in',
            user: { id: 1, username: 'testuser', role: 'user' }
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
            expect(authService.login).toHaveBeenCalledWith('testuser', 'password123');
        });
    });

    it('displays error on failed login', async () => {
        jest.mocked(authService.login).mockRejectedValueOnce({ response: { data: { message: 'Invalid credentials' } } });

        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        fireEvent.click(screen.getByRole('button', { name: /login/i }));

        await waitFor(() => {
            expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
        });
    });
});
