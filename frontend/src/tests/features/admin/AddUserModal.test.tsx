import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddUserModal from '../../../features/admin/users/AddUserModal';

const fillField = (label: RegExp | string, value: string) => {
    const field = screen.getByLabelText(label, { exact: false });
    fireEvent.change(field, { target: { value } });
};

describe('AddUserModal', () => {
    const onClose = jest.fn();
    const onSave = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        onSave.mockResolvedValue(undefined);
    });

    const renderModal = (props = {}) =>
        render(<AddUserModal isOpen onClose={onClose} onSave={onSave} {...props} />);

    it('renders nothing when closed', () => {
        const { container } = render(
            <AddUserModal isOpen={false} onClose={onClose} onSave={onSave} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the username/password/role fields and password policy hint', () => {
        renderModal();

        expect(screen.getByRole('heading', { name: /create new user/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/^username/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^role/i)).toBeInTheDocument();
        expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });

    it('offers the admin role in the role select', () => {
        renderModal();

        const roleSelect = screen.getByLabelText(/^role/i);
        expect(roleSelect).toHaveValue('user');
        fireEvent.change(roleSelect, { target: { value: 'admin' } });
        expect(roleSelect).toHaveValue('admin');
        expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument();
    });

    it('blocks a short password client-side with an inline message', () => {
        renderModal();

        fillField(/^username/i, 'newuser');
        fillField(/^password/i, 'short');
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('blocks a short username client-side with an inline message', () => {
        renderModal();

        fillField(/^username/i, 'ab');
        fillField(/^password/i, 'password123');
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        expect(screen.getByText(/username must be at least 3 characters/i)).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('submits the payload and closes through the parent on success', async () => {
        renderModal();

        fillField(/^username/i, 'newuser');
        fillField(/^password/i, 'password123');
        fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: 'admin' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith({
                username: 'newuser',
                password: 'password123',
                role: 'admin',
            });
        });
        // The modal itself stays open; the parent closes it via isOpen.
        expect(screen.getByRole('heading', { name: /create new user/i })).toBeInTheDocument();
    });

    it('shows a duplicate-username 409 inline and keeps the dialog open', async () => {
        onSave.mockRejectedValueOnce({
            response: { status: 409, data: { message: 'Username already exists.' } },
        });
        renderModal();

        fillField(/^username/i, 'newadmin');
        fillField(/^password/i, 'password123');
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Username already exists.');
        expect(screen.getByRole('heading', { name: /create new user/i })).toBeInTheDocument();
        // The typed values survive for an easy edit-and-retry.
        expect(screen.getByLabelText(/^username/i)).toHaveValue('newadmin');
    });

    it('shows a readable message for a backend Zod validation failure', async () => {
        onSave.mockRejectedValueOnce({
            response: {
                status: 400,
                data: {
                    message: 'Validation failed',
                    errors: [
                        { code: 'too_small', path: ['password'], message: 'Too small: expected string to have >=8 characters' },
                    ],
                },
            },
        });
        renderModal();

        fillField(/^username/i, 'newuser');
        fillField(/^password/i, 'password123');
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Password must be at least 8 characters long.',
        );
    });

    it('falls back to a generic message when the error carries nothing readable', async () => {
        onSave.mockRejectedValueOnce({});
        renderModal();

        fillField(/^username/i, 'newuser');
        fillField(/^password/i, 'password123');
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create user.');
    });

    it('clears the server error once the admin edits a field', async () => {
        onSave.mockRejectedValueOnce({
            response: { status: 409, data: { message: 'Username already exists.' } },
        });
        renderModal();

        fillField(/^username/i, 'newadmin');
        fillField(/^password/i, 'password123');
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        await screen.findByRole('alert');

        fillField(/^username/i, 'newadmin2');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('resets the form when reopened', async () => {
        onSave.mockRejectedValueOnce({
            response: { status: 409, data: { message: 'Username already exists.' } },
        });
        const { rerender } = renderModal();

        fillField(/^username/i, 'newadmin');
        fillField(/^password/i, 'password123');
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        await screen.findByRole('alert');

        rerender(<AddUserModal isOpen={false} onClose={onClose} onSave={onSave} />);
        rerender(<AddUserModal isOpen onClose={onClose} onSave={onSave} />);

        expect(screen.getByLabelText(/^username/i)).toHaveValue('');
        expect(screen.getByLabelText(/^password/i)).toHaveValue('');
        expect(screen.getByLabelText(/^role/i)).toHaveValue('user');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
