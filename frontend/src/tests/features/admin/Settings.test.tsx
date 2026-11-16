import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Settings from '../../../features/admin/settings/Settings';
import adminService from '../../../services/adminService';
import contestService from '../../../services/contestService';
import { SettingsContext } from '../../../context/SettingsContext';

jest.mock('../../../services/adminService');
jest.mock('../../../services/contestService');

const mockRefreshSettings = jest.fn();
const renderSettings = () => render(
  <SettingsContext.Provider value={{
    refreshSettings: mockRefreshSettings, isLoading: false, registrationEnabled: true, accessMode: 'public', passwordChangeEnabled: true, isPrivateMode: false,
  }}>
    <Settings />
  </SettingsContext.Provider>,
);

describe('Settings page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(adminService.getRegistrationSettings).mockResolvedValue({ enabled: true } as never);
    jest.mocked(adminService.getSiteAccessMode).mockResolvedValue({ accessMode: 'public' });
    jest.mocked(adminService.getPasswordChangeSettings).mockResolvedValue({ enabled: false } as never);
    jest.mocked(adminService.updateRegistrationSettings).mockResolvedValue({} as never);
    jest.mocked(adminService.updatePasswordChangeSettings).mockResolvedValue({} as never);
    jest.mocked(adminService.updateSiteAccessMode).mockResolvedValue({} as never);
    jest.mocked(contestService.getAll).mockResolvedValue([]);
  });
  afterEach(() => jest.useRealTimers());

  it('groups the rows into Access, Data and a Danger zone', async () => {
    renderSettings();
    expect(await screen.findByRole('heading', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument();
    expect(screen.getByText('Site visibility')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Registration' })).toBeChecked();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Password changes' })).not.toBeChecked());
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace database…' })).toBeInTheDocument();
  });

  it('saving shows "Saved" and hides it after 3 s', async () => {
    renderSettings();
    const sw = await screen.findByRole('switch', { name: 'Registration' });
    jest.useFakeTimers();
    await act(async () => { fireEvent.click(sw); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    await act(async () => { jest.advanceTimersByTime(3100); });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('a failed save keeps the old value and shows an inline error instead of Saved', async () => {
    jest.mocked(adminService.updateRegistrationSettings).mockRejectedValue(new Error('down'));
    renderSettings();
    const sw = await screen.findByRole('switch', { name: 'Registration' });
    fireEvent.click(sw);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update registration settings.');
    expect(sw).toBeChecked();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('switching to Private asks first and warns about a running contest', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([{ id: 1, title: 'Mid-term practice', status: 'running' } as never]);
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Private' }));
    const dialog = await screen.findByRole('dialog', { name: 'Make the site private?' });
    expect(dialog).toHaveTextContent('Mid-term practice is running — guests following it lose access.');
    expect(adminService.updateSiteAccessMode).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make private' }));
    await waitFor(() => expect(adminService.updateSiteAccessMode).toHaveBeenCalledWith('private'));
  });

  it('Replace database… takes a file then the IMPORT confirmation', async () => {
    jest.mocked(adminService.importDatabase).mockResolvedValue({ jobId: 'j1', progressToken: 't' } as never);
    jest.mocked(adminService.getImportDatabaseProgress).mockResolvedValue({ status: 'done', message: 'ok' } as never);
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Replace database…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace database' });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['-- dump'], 'backup.sql', { type: 'application/sql' });
    fireEvent.change(input, { target: { files: [file] } });
    const replace = within(dialog).getByRole('button', { name: 'Replace database' });
    expect(replace).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'IMPORT' } });
    fireEvent.click(replace);
    await waitFor(() => expect(adminService.importDatabase).toHaveBeenCalled());
  });
});
