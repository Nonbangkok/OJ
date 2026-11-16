import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import UserEditDrawer from '../../../features/admin/users/UserEditDrawer';
import adminService from '../../../services/adminService';
import type { AdminUser } from '../../../types';

jest.mock('../../../services/adminService');

const user: AdminUser = { id: 2, username: 'nattapat', role: 'user', submissions_locked: false, created_at: '2026-05-20T03:00:00Z' };

describe('UserEditDrawer', () => {
  it('a lock failure after the account saved says what saved, refreshes, and retries only the lock', async () => {
    jest.mocked(adminService.updateUser).mockResolvedValue({} as never);
    jest.mocked(adminService.setUserSubmissionLock).mockRejectedValueOnce({ response: { status: 500, data: { message: 'down' } } });
    const onSaved = jest.fn();
    const onChanged = jest.fn();
    render(<UserEditDrawer user={user} onClose={jest.fn()} onSaved={onSaved} onChanged={onChanged} onResetPassword={jest.fn()} />);
    const drawer = screen.getByRole('dialog', { name: 'Edit nattapat' });
    fireEvent.change(within(drawer).getByLabelText('Username'), { target: { value: 'nattapat2' } });
    fireEvent.click(within(drawer).getByRole('switch', { name: 'Lock submissions' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));

    expect(await within(drawer).findByRole('alert')).toHaveTextContent("Username and role saved. The submission lock didn't change: down");
    expect(onChanged).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    jest.mocked(adminService.setUserSubmissionLock).mockResolvedValue({} as never);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(adminService.updateUser).toHaveBeenCalledTimes(1);
    expect(adminService.setUserSubmissionLock).toHaveBeenCalledTimes(2);
  });

  it('nothing saved yet: a failed account update says so and sends nothing else', async () => {
    jest.mocked(adminService.updateUser).mockRejectedValue({ response: { status: 409, data: { message: 'Username already exists' } } });
    render(<UserEditDrawer user={user} onClose={jest.fn()} onSaved={jest.fn()} onChanged={jest.fn()} onResetPassword={jest.fn()} />);
    const drawer = screen.getByRole('dialog', { name: 'Edit nattapat' });
    fireEvent.change(within(drawer).getByLabelText('Username'), { target: { value: 'ploy.s' } });
    fireEvent.click(within(drawer).getByRole('switch', { name: 'Lock submissions' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Username already exists');
    expect(adminService.setUserSubmissionLock).not.toHaveBeenCalled();
  });

  it('a lock-only change sends only the lock', async () => {
    jest.mocked(adminService.setUserSubmissionLock).mockResolvedValue({} as never);
    const onSaved = jest.fn();
    render(<UserEditDrawer user={user} onClose={jest.fn()} onSaved={onSaved} onChanged={jest.fn()} onResetPassword={jest.fn()} />);
    const drawer = screen.getByRole('dialog', { name: 'Edit nattapat' });
    fireEvent.click(within(drawer).getByRole('switch', { name: 'Lock submissions' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(adminService.updateUser).not.toHaveBeenCalled();
    expect(adminService.setUserSubmissionLock).toHaveBeenCalledWith(2, true);
  });
});
