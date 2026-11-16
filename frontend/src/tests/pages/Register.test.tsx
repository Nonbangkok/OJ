import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Register from '../../pages/auth/Register';
import authService from '../../services/authService';

jest.mock('../../services/authService');
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
    useNavigate: () => mockNavigate
}));

describe('Register Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders register form', () => {
        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );
        expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    });

    it('displays error if username is too short', async () => {
        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'ab' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'password123' } });
        fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
            expect(screen.getByText(/username must be at least 3 characters/i)).toBeInTheDocument();
        });
        expect(authService.register).not.toHaveBeenCalled();
    });

    it('displays error if password is too short', async () => {
        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: '12345' } });
        fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: '12345' } });
        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
            expect(screen.getByText(/password must be at least 6 characters/i)).toBeInTheDocument();
        });
        expect(authService.register).not.toHaveBeenCalled();
    });

    it('submits registration successfully', async () => {
        jest.mocked(authService.register).mockResolvedValueOnce({
            message: 'Registered',
            user: { id: 1, username: 'newuser' }
        });

        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } });
        fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass123' } });
        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
            expect(authService.register).toHaveBeenCalledWith('newuser', 'pass123');
        });
        // The success message travels with the redirect so the login page can
        // show it — setting it here would unmount before it is ever seen.
        expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { registered: true } });
    });

    it('disables the submit button while registration is pending', async () => {
        let resolveRegister: (value: unknown) => void = () => {};
        jest.mocked(authService.register).mockImplementationOnce(
            () => new Promise((resolve) => { resolveRegister = resolve; }) as never
        );

        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } });
        fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass123' } });
        const button = screen.getByRole('button', { name: /create account/i });
        fireEvent.click(button);

        await waitFor(() => expect(button).toBeDisabled());
        fireEvent.click(button);
        expect(authService.register).toHaveBeenCalledTimes(1);

        resolveRegister({ message: 'Registered', user: { id: 1, username: 'newuser' } });
        await waitFor(() => expect(button).toBeEnabled());
    });

    it('displays error on failed registration from service', async () => {
        jest.mocked(authService.register).mockRejectedValueOnce({
            response: { data: { message: 'Username already taken' } }
        });

        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } });
        fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass123' } });
        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
            expect(screen.getByText(/username already taken/i)).toBeInTheDocument();
        });
    });

    it('confirm mismatch shows a field error and blocks submit', async () => {
        render(<BrowserRouter><Register /></BrowserRouter>);
        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } });
        fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass124' } });
        fireEvent.click(screen.getByRole('button', { name: /create account/i }));
        expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute('aria-invalid', 'true');
        expect(authService.register).not.toHaveBeenCalled();
    });

    it('shows the field hints', () => {
        render(<BrowserRouter><Register /></BrowserRouter>);
        expect(screen.getByText('At least 3 characters.')).toBeInTheDocument();
        expect(screen.getByText('At least 6 characters.')).toBeInTheDocument();
        expect(screen.getByLabelText(/^password/i)).toHaveAttribute('autocomplete', 'new-password');
    });
});
