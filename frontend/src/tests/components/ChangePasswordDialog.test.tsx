import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangePasswordDialog from '../../components/user/ChangePasswordDialog';
import authService from '../../services/authService';

jest.mock('../../services/authService');

const fillField = (label: RegExp | string, value: string) => {
    const field = screen.getByLabelText(label, { exact: false });
    fireEvent.change(field, { target: { value } });
};

describe('ChangePasswordDialog (AUTH-004)', () => {
    const onClose = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    const renderDialog = (open = true) =>
        render(<ChangePasswordDialog open={open} onClose={onClose} />);

    it('renders nothing when closed', () => {
        const { container } = renderDialog(false);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the three password fields when open', () => {
        renderDialog();
        expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument();
        expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    });

    it('shows the cross-session sign-out hint', () => {
        renderDialog();
        expect(
            screen.getByText(/signs out all your other sessions/i),
        ).toBeInTheDocument();
    });

    it('rejects a short new password client-side', async () => {
        renderDialog();
        fillField(/current password/i, 'oldpassword1');
        fillField(/^new password/i, 'short');
        fillField(/confirm new password/i, 'short');
        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        expect(
            await screen.findByText(/must be at least 8 characters/i),
        ).toBeInTheDocument();
        expect(authService.changePassword).not.toHaveBeenCalled();
    });

    it('rejects mismatched confirmation client-side', async () => {
        renderDialog();
        fillField(/current password/i, 'oldpassword1');
        fillField(/^new password/i, 'newpassword45');
        fillField(/confirm new password/i, 'differentpass');
        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
        expect(authService.changePassword).not.toHaveBeenCalled();
    });

    it('rejects a new password identical to the current one', async () => {
        renderDialog();
        fillField(/current password/i, 'samepassword1');
        fillField(/^new password/i, 'samepassword1');
        fillField(/confirm new password/i, 'samepassword1');
        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        expect(
            await screen.findByText(/must be different from the current one/i),
        ).toBeInTheDocument();
        expect(authService.changePassword).not.toHaveBeenCalled();
    });

    it('submits the credentials and shows the success message', async () => {
        (jest.mocked(authService.changePassword) as jest.Mock).mockResolvedValueOnce({
            message: 'Password changed successfully. Other sessions have been signed out.',
        });
        renderDialog();
        fillField(/current password/i, 'oldpassword1');
        fillField(/^new password/i, 'newpassword45');
        fillField(/confirm new password/i, 'newpassword45');
        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Password changed successfully. Other sessions have been signed out.',
        );
        await waitFor(() => {
            expect(authService.changePassword).toHaveBeenCalledWith({
                currentPassword: 'oldpassword1',
                newPassword: 'newpassword45',
            });
        });
    });

    it('shows the server error inline when the current password is wrong', async () => {
        (jest.mocked(authService.changePassword) as jest.Mock).mockRejectedValueOnce({
            response: { status: 401, data: { message: 'Current password is incorrect' } },
        });
        renderDialog();
        fillField(/current password/i, 'wrongpassword');
        fillField(/^new password/i, 'newpassword45');
        fillField(/confirm new password/i, 'newpassword45');
        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        expect(
            await screen.findByText('Current password is incorrect'),
        ).toBeInTheDocument();
        // The form stays mounted so the user can retry.
        expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    });

    it('shows a generic error when the server fails without a message', async () => {
        (jest.mocked(authService.changePassword) as jest.Mock).mockRejectedValueOnce(
            new Error('Network Error'),
        );
        renderDialog();
        fillField(/current password/i, 'oldpassword1');
        fillField(/^new password/i, 'newpassword45');
        fillField(/confirm new password/i, 'newpassword45');
        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        expect(await screen.findByText('Network Error')).toBeInTheDocument();
    });

    it('clears the form when reopened', () => {
        const { rerender } = renderDialog();
        fillField(/current password/i, 'oldpassword1');
        rerender(<ChangePasswordDialog open={false} onClose={onClose} />);
        rerender(<ChangePasswordDialog open onClose={onClose} />);

        expect(screen.getByLabelText(/current password/i)).toHaveValue('');
        expect(screen.getByLabelText(/^new password/i)).toHaveValue('');
        expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
    });
});
