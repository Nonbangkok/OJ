import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
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

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'testuser' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong-password' } });
        fireEvent.click(screen.getByRole('button', { name: /login/i }));

        await waitFor(() => {
            expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
        });
    });

    it('shows the registration success notice after a redirect from Register', () => {
        render(
            <MemoryRouter initialEntries={[{ pathname: '/login', state: { registered: true } }]}>
                <Login />
            </MemoryRouter>
        );
        expect(screen.getByRole('status')).toHaveTextContent('Registration successful! Please log in.');
    });

    it('shows no registration notice on a plain visit', () => {
        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );
        expect(screen.queryByText(/registration successful/i)).not.toBeInTheDocument();
    });

    it('disables the submit button while login is pending', async () => {
        let resolveLogin: (value: unknown) => void = () => {};
        jest.mocked(authService.login).mockImplementationOnce(
            () => new Promise((resolve) => { resolveLogin = resolve; }) as never
        );

        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'testuser' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
        const button = screen.getByRole('button', { name: /login/i });
        fireEvent.click(button);

        await waitFor(() => expect(button).toBeDisabled());
        fireEvent.click(button);
        expect(authService.login).toHaveBeenCalledTimes(1);

        resolveLogin({ message: 'Logged in', user: { id: 1, username: 'testuser', role: 'user', hasAvatar: false } });
        await waitFor(() => expect(button).toBeEnabled());
    });
});
