import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
});
