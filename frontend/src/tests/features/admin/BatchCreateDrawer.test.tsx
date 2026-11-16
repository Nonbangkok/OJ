import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BatchCreateDrawer from '../../../features/admin/users/BatchCreateDrawer';
import adminService from '../../../services/adminService';
import { downloadCsv } from '../../../utils/downloadCsv';

jest.mock('../../../services/adminService');
jest.mock('../../../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));

describe('BatchCreateDrawer', () => {
  it('creates, then shows the passwords once with Copy, Download CSV and a warning', async () => {
    jest.mocked(adminService.createBatchUsers).mockResolvedValue({
      message: 'ok', users: [{ username: 'm42_01', password: 'kite-41-oak' }, { username: 'm42_02', password: 'moss-88-tin' }],
    });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onDone = jest.fn();
    render(<BatchCreateDrawer open onClose={jest.fn()} onDone={onDone} />);
    const drawer = screen.getByRole('dialog', { name: 'Create users' });
    fireEvent.change(within(drawer).getByLabelText('Username prefix'), { target: { value: 'm42_' } });
    fireEvent.change(within(drawer).getByLabelText('How many'), { target: { value: '2' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create 2 users' }));

    const result = await screen.findByRole('dialog', { name: 'Created 2 users' });
    expect(adminService.createBatchUsers).toHaveBeenCalledWith({ prefix: 'm42_', count: 2 });
    expect(result).toHaveTextContent(/Save these passwords now\.\s*They won't be shown again/);
    expect(within(result).getByText('kite-41-oak')).toBeInTheDocument();
    fireEvent.click(within(result).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('username\tpassword\nm42_01\tkite-41-oak\nm42_02\tmoss-88-tin'));
    fireEvent.click(within(result).getByRole('button', { name: 'Download CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith('new-users.csv', [['username', 'password'], ['m42_01', 'kite-41-oak'], ['m42_02', 'moss-88-tin']]);
    fireEvent.click(within(result).getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });

  const createTwo = async () => {
    jest.mocked(adminService.createBatchUsers).mockResolvedValue({
      message: 'ok', users: [{ username: 'm42_01', password: 'kite-41-oak' }, { username: 'm42_02', password: 'moss-88-tin' }],
    });
    const onDone = jest.fn();
    render(<BatchCreateDrawer open onClose={jest.fn()} onDone={onDone} />);
    const drawer = screen.getByRole('dialog', { name: 'Create users' });
    fireEvent.change(within(drawer).getByLabelText('Username prefix'), { target: { value: 'm42_' } });
    fireEvent.change(within(drawer).getByLabelText('How many'), { target: { value: '2' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create 2 users' }));
    await screen.findByRole('dialog', { name: 'Created 2 users' });
    return onDone;
  };

  it('closing before the passwords are copied or downloaded asks first', async () => {
    const onDone = await createTwo();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const confirm = await screen.findByRole('dialog', { name: 'Close without saving the passwords?' });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('kite-41-oak')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Close without saving the passwords?' })).getByRole('button', { name: 'Close anyway' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('Escape on the result asks instead of dropping the passwords', async () => {
    const onDone = await createTwo();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: 'Close without saving the passwords?' })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText('kite-41-oak')).toBeInTheDocument();
  });

  it('allows up to the server cap of 100 accounts, not more', () => {
    render(<BatchCreateDrawer open onClose={jest.fn()} onDone={jest.fn()} />);
    const drawer = screen.getByRole('dialog', { name: 'Create users' });
    fireEvent.change(within(drawer).getByLabelText('Username prefix'), { target: { value: 'm42_' } });
    fireEvent.change(within(drawer).getByLabelText('How many'), { target: { value: '101' } });
    expect(within(drawer).getByRole('button', { name: 'Create users' })).toBeDisabled();
    expect(drawer).toHaveTextContent('1–100');
    fireEvent.change(within(drawer).getByLabelText('How many'), { target: { value: '100' } });
    expect(within(drawer).getByRole('button', { name: 'Create 100 users' })).toBeEnabled();
  });
});
