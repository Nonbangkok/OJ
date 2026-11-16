import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UserManagement from '../../../features/admin/users/UserManagement';
import adminService from '../../../services/adminService';
import { useAuth } from '../../../context/AuthContext';
import { downloadCsv } from '../../../utils/downloadCsv';

jest.mock('../../../services/adminService');
jest.mock('../../../context/AuthContext');
jest.mock('../../../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));

const user = (id: number, username: string, over: Record<string, unknown> = {}) => ({
  id, username, role: 'user', created_at: '2025-03-04T00:00:00Z', submissions_locked: false,
  last_active_at: new Date(Date.now() - 14 * 60_000).toISOString(), solved_count: 96, xp: 1940, submission_count: 642, ...over,
});
const rows = [
  user(1, 'Nonbangkok', { role: 'admin' }), user(2, 'nattapat'), user(3, 'tonkla', { submissions_locked: true, solved_count: 180 }),
  user(4, 'kru.somchai', { role: 'staff' }),
];

const renderPage = (path = '/admin/users') => render(<MemoryRouter initialEntries={[path]}><UserManagement /></MemoryRouter>);
const rowFor = (name: string) => screen.getByRole('button', { name }).closest('tr') as HTMLElement;

describe('Users page', () => {
  beforeEach(() => {
    jest.mocked(useAuth).mockReturnValue({ user: { id: 9, username: 'boss', role: 'admin' }, isLoading: false } as ReturnType<typeof useAuth>);
    jest.mocked(adminService.getUsers).mockImplementation(async (q) => {
      if (q?.limit === 1) return { users: [], total: q.role === 'staff' ? 3 : q.role === 'admin' ? 1 : 412, page: 1, limit: 1 };
      return { users: rows as never, total: rows.length, page: 1, limit: 50 };
    });
    jest.mocked(adminService.setUsersSubmissionLock).mockResolvedValue({} as never);
    jest.mocked(adminService.setUsersRole).mockResolvedValue({ updated: [3], skipped: [{ id: 1, reason: 'protected' }] });
  });

  it('header: counts, Create users, and Add user under the page menu', async () => {
    renderPage();
    expect(await screen.findByText('412 accounts · 3 staff · 1 admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create users' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More user actions' }), { delay: 20 } as never);
    expect(await screen.findByRole('menuitem', { name: 'Add user' })).toBeInTheDocument();
  });

  it('columns: username link, role, status dot, solved, joined, last active', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'tonkla' });
    const row = rowFor('tonkla');
    expect(within(row).getByText('Locked')).toBeInTheDocument();
    expect(within(row).getByText('180')).toBeInTheDocument();
    expect(within(rowFor('nattapat')).getByText('14 minutes ago')).toBeInTheDocument();
  });

  it('the row menu links to the profile', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'nattapat' });
    await userEvent.click(within(rowFor('nattapat')).getByRole('button', { name: /Actions for nattapat/ }), { delay: 20 } as never);
    expect(await screen.findByRole('menuitem', { name: 'View profile' })).toBeInTheDocument();
  });

  it('role and locked filters reach the server and clear the selection', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'tonkla' });
    fireEvent.click(within(rowFor('tonkla')).getByRole('checkbox'));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Staff' }));
    await waitFor(() => expect(adminService.getUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'staff' })));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('bulk Lock, Change role (with skipped report) and Export CSV act on the selection', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'tonkla' });
    fireEvent.click(within(rowFor('tonkla')).getByRole('checkbox'));
    fireEvent.click(within(rowFor('nattapat')).getByRole('checkbox'));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(adminService.setUsersSubmissionLock).toHaveBeenCalledWith(expect.arrayContaining([2, 3]), true));

    await userEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'More bulk actions' }), { delay: 20 } as never);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export CSV' }), { delay: 20 } as never);
    expect(downloadCsv).toHaveBeenCalledWith('users.csv', expect.arrayContaining([['username', 'role', 'status', 'solved', 'joined'], expect.arrayContaining(['tonkla'])]));

    fireEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Change role' }));
    const dialog = await screen.findByRole('dialog', { name: /Change role/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Staff' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(adminService.setUsersRole).toHaveBeenCalledWith(expect.arrayContaining([2, 3]), 'staff'));
    expect(await screen.findByText(/1 user skipped/)).toBeInTheDocument();
  });

  it('edit drawer saves username and role; protected admin has no edit or delete', async () => {
    jest.mocked(adminService.updateUser).mockResolvedValue({} as never);
    renderPage();
    await screen.findByRole('button', { name: 'nattapat' });
    fireEvent.click(screen.getByRole('button', { name: 'nattapat' }));
    const drawer = await screen.findByRole('dialog', { name: 'Edit nattapat' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Staff' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(adminService.updateUser).toHaveBeenCalledWith(2, { username: 'nattapat', role: 'staff' }));

    await userEvent.click(within(rowFor('Nonbangkok')).getByRole('button', { name: /Actions for Nonbangkok/ }), { delay: 20 } as never);
    expect(screen.queryByRole('menuitem', { name: 'Delete user' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  });

  it('delete is type-to-confirm and names the submissions and solves that go with it', async () => {
    jest.mocked(adminService.deleteUser).mockResolvedValue({ message: 'ok' });
    renderPage();
    await screen.findByRole('button', { name: 'tonkla' });
    await userEvent.click(within(rowFor('tonkla')).getByRole('button', { name: /Actions for tonkla/ }), { delay: 20 } as never);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete user' }), { delay: 20 } as never);
    const dialog = await screen.findByRole('dialog', { name: 'Delete tonkla?' });
    expect(dialog).toHaveTextContent('642 submissions and 180 solves');
    const confirm = within(dialog).getByRole('button', { name: 'Delete user' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'tonkla' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(adminService.deleteUser).toHaveBeenCalledWith(3));
  });
});
