import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Register from '../../pages/Register';
import api from '../../services/api';

jest.mock('../../services/api');
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
        expect(screen.getByRole('heading', { name: /register/i })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: /register/i }));

        await waitFor(() => {
            expect(screen.getByText(/username must be at least 3 characters/i)).toBeInTheDocument();
        });
        expect(api.post).not.toHaveBeenCalled();
    });

    it('displays error if password is too short', async () => {
        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: '12345' } });
        fireEvent.click(screen.getByRole('button', { name: /register/i }));

        await waitFor(() => {
            expect(screen.getByText(/password must be at least 6 characters/i)).toBeInTheDocument();
        });
        expect(api.post).not.toHaveBeenCalled();
    });

    it('submits registration successfully', async () => {
        api.post.mockResolvedValueOnce({});

        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } });
        fireEvent.click(screen.getByRole('button', { name: /register/i }));

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/register', {
                username: 'newuser',
                password: 'pass123',
            });
        });
    });

    it('displays error on failed registration', async () => {
        api.post.mockRejectedValueOnce({ response: { data: { message: 'Username exists' } } });

        render(
            <BrowserRouter>
                <Register />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } });
        fireEvent.click(screen.getByRole('button', { name: /register/i }));

        await waitFor(() => {
            expect(screen.getByText(/username exists/i)).toBeInTheDocument();
        });
    });
});
