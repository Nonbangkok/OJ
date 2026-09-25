import { render, screen, fireEvent } from '@testing-library/react';
import ResetPasswordModal from '../../../features/admin/users/ResetPasswordModal';
import adminService from '../../../services/adminService';
import type { AdminUser } from '../../../types';

jest.mock('../../../services/adminService');

const mockUser: AdminUser = { id: 2, username: 'user1', role: 'user' };

const fillField = (label: RegExp | string, value: string) => {
    const field = screen.getByLabelText(label, { exact: false });
    fireEvent.change(field, { target: { value } });
};

describe('ResetPasswordModal (AUTH-004)', () => {
    const onClose = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders nothing when no user is selected', () => {
        const { container } = render(<ResetPasswordModal user={null} onClose={onClose} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the two password fields named for the target user', () => {
        render(<ResetPasswordModal user={mockUser} onClose={onClose} />);
        expect(
            screen.getByRole('heading', { name: 'Reset Password — user1' }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    });

    it('warns that the user is signed out of every device', () => {
        render(<ResetPasswordModal user={mockUser} onClose={onClose} />);
        expect(screen.getByText(/signs this user out of every device/i)).toBeInTheDocument();
    });

    it('rejects a short password client-side', () => {
        render(<ResetPasswordModal user={mockUser} onClose={onClose} />);
        fillField(/^new password/i, 'short');
        fillField(/confirm new password/i, 'short');
        fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

        expect(screen.getByText(/must be at least 8 characters/i)).toBeInTheDocument();
        expect(adminService.resetUserPassword).not.toHaveBeenCalled();
    });

    it('rejects mismatched confirmation client-side', () => {
        render(<ResetPasswordModal user={mockUser} onClose={onClose} />);
        fillField(/^new password/i, 'newpassword45');
        fillField(/confirm new password/i, 'otherpassword');
        fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

        expect(screen.getByText(/do not match/i)).toBeInTheDocument();
        expect(adminService.resetUserPassword).not.toHaveBeenCalled();
    });

    it('submits and shows the success message', async () => {
        (jest.mocked(adminService.resetUserPassword) as jest.Mock).mockResolvedValueOnce({
            message: 'Password reset for user 2. They will need to sign in again.',
        });
        render(<ResetPasswordModal user={mockUser} onClose={onClose} />);
        fillField(/^new password/i, 'newpassword45');
        fillField(/confirm new password/i, 'newpassword45');
        fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Password reset for user 2. They will need to sign in again.',
        );
        expect(adminService.resetUserPassword).toHaveBeenCalledWith(2, {
            newPassword: 'newpassword45',
        });
    });

    it('shows a protected-account 403 inline', async () => {
        (jest.mocked(adminService.resetUserPassword) as jest.Mock).mockRejectedValueOnce({
            response: {
                status: 403,
                data: { message: 'The "Nonbangkok" account password can only be changed by its owner.' },
            },
        });
        render(<ResetPasswordModal user={mockUser} onClose={onClose} />);
        fillField(/^new password/i, 'newpassword45');
        fillField(/confirm new password/i, 'newpassword45');
        fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

        expect(
            await screen.findByText(/can only be changed by its owner/i),
        ).toBeInTheDocument();
    });
});
