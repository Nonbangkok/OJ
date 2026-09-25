import { render, waitFor, act } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import authService from '../../services/authService';
import { SettingsProvider, useSettings } from '../../context/SettingsContext';

jest.mock('../../services/authService');

const getSiteConfig = authService.getSiteConfig as jest.Mock;

// Probe component that records the exposed settings.
const SettingsProbe = ({ onChange }: { onChange: (value: { registrationEnabled: boolean; passwordChangeEnabled: boolean }) => void }) => {
  const { registrationEnabled, passwordChangeEnabled, isPrivateMode } = useSettings();
  onChange({ registrationEnabled, passwordChangeEnabled });
  return <div>{isPrivateMode ? 'private' : 'public'}</div>;
};

describe('SettingsContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches settings once on mount', async () => {
    getSiteConfig.mockResolvedValue({ allowRegistration: true, accessMode: 'public', passwordChangeEnabled: true });
    const probe = jest.fn();
    render(
      <SettingsProvider>
        <SettingsProbe onChange={probe} />
      </SettingsProvider>
    );

    await waitFor(() => expect(getSiteConfig).toHaveBeenCalledTimes(1));
  });

  it('refetches settings on window focus (XSYS-011)', async () => {
    getSiteConfig.mockResolvedValue({ allowRegistration: true, accessMode: 'public', passwordChangeEnabled: true });
    const probe = jest.fn();
    render(
      <SettingsProvider>
        <SettingsProbe onChange={probe} />
      </SettingsProvider>
    );

    await waitFor(() => expect(getSiteConfig).toHaveBeenCalledTimes(1));

    // An admin toggled registration off elsewhere; the focus refetch must
    // pick the new value up instead of staying stale until a reload.
    getSiteConfig.mockResolvedValue({ allowRegistration: false, accessMode: 'public', passwordChangeEnabled: false });

    act(() => {
      fireEvent(window, new Event('focus'));
    });

    await waitFor(() => expect(getSiteConfig).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(probe).toHaveBeenLastCalledWith({ registrationEnabled: false, passwordChangeEnabled: false })
    );
  });

  it('keeps the safe defaults when the fetch fails', async () => {
    getSiteConfig.mockRejectedValue(new Error('network down'));
    const probe = jest.fn();

    render(
      <SettingsProvider>
        <SettingsProbe onChange={probe} />
      </SettingsProvider>
    );

    await waitFor(() => expect(probe).toHaveBeenLastCalledWith({ registrationEnabled: true, passwordChangeEnabled: true }));
  });
});
