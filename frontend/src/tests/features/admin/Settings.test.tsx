import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../../../features/admin/settings/Settings';
import adminService from '../../../services/adminService';
import { SettingsContext } from '../../../context/SettingsContext';
import React from 'react';

jest.mock('../../../services/adminService');

const mockRefreshSettings = jest.fn();

const renderSettings = () =>
    render(
        <SettingsContext.Provider
            value={{
                refreshSettings: mockRefreshSettings,
                isLoading: false,
                registrationEnabled: true,
                accessMode: 'public',
                passwordChangeEnabled: true,
                isPrivateMode: false,
            }}
        >
            <Settings />
        </SettingsContext.Provider>
    );

describe('Settings page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(adminService.getRegistrationSettings) as jest.Mock).mockResolvedValue({ enabled: true });
        (jest.mocked(adminService.getSiteAccessMode) as jest.Mock).mockResolvedValue({ accessMode: 'public' });
        (jest.mocked(adminService.getPasswordChangeSettings) as jest.Mock).mockResolvedValue({ enabled: true });
    });

    describe('registration toggle', () => {
        it('renders the toggle as on when registration is enabled', async () => {
            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow user registration' });
            expect(toggle).toBeChecked();
        });

        it('clicking the visible switch toggles registration (toggle control forwards clicks to the input)', async () => {
            (jest.mocked(adminService.updateRegistrationSettings) as jest.Mock).mockResolvedValueOnce({
                message: 'Registration setting updated successfully.',
            });

            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow user registration' });

            // Click the toggle's visible control (the wrapping switch element,
            // not the 0x0 checkbox itself). If the switch were a plain span
            // that doesn't forward clicks, this click would be lost.
            const switchControl = toggle.closest('label,span');
            expect(switchControl).not.toBeNull();
            await userEvent.click(switchControl as HTMLElement);

            await waitFor(() => {
                expect(adminService.updateRegistrationSettings).toHaveBeenCalledWith(false);
            });
            await waitFor(() => {
                expect(toggle).not.toBeChecked();
            });
            expect(mockRefreshSettings).toHaveBeenCalled();
        });

        it('clicking the text label also toggles registration', async () => {
            (jest.mocked(adminService.updateRegistrationSettings) as jest.Mock).mockResolvedValueOnce({
                message: 'Registration setting updated successfully.',
            });

            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow user registration' });
            await userEvent.click(screen.getByText('Allow user registration'));

            await waitFor(() => {
                expect(adminService.updateRegistrationSettings).toHaveBeenCalledWith(false);
            });
            await waitFor(() => {
                expect(toggle).not.toBeChecked();
            });
        });

        it('shows an error and keeps the current state when the update fails', async () => {
            (jest.mocked(adminService.updateRegistrationSettings) as jest.Mock).mockRejectedValueOnce(
                new Error('network')
            );

            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow user registration' });
            await userEvent.click(toggle);

            await waitFor(() => {
                expect(screen.getByText('Failed to update registration settings.')).toBeInTheDocument();
            });
            expect(toggle).toBeChecked();
            expect(mockRefreshSettings).not.toHaveBeenCalled();
        });
    });

    describe('site access', () => {
        it('selecting Private saves the mode', async () => {
            (jest.mocked(adminService.updateSiteAccessMode) as jest.Mock).mockResolvedValueOnce({
                message: 'Site access mode updated successfully.',
            });

            renderSettings();

            const privateRadio = await screen.findByRole('radio', { name: /private/i });
            await userEvent.click(privateRadio);

            await waitFor(() => {
                expect(adminService.updateSiteAccessMode).toHaveBeenCalledWith('private');
            });
        });
    });

    describe('password change toggle', () => {
        it('renders the toggle as on when password changes are enabled', async () => {
            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow password changes' });
            expect(toggle).toBeChecked();
        });

        it('renders the toggle as off when the fetched setting is disabled', async () => {
            (jest.mocked(adminService.getPasswordChangeSettings) as jest.Mock).mockResolvedValue({ enabled: false });

            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow password changes' });
            expect(toggle).not.toBeChecked();
        });

        it('toggling calls the update service and refreshes the app-wide settings', async () => {
            (jest.mocked(adminService.updatePasswordChangeSettings) as jest.Mock).mockResolvedValueOnce({
                message: 'Password change setting updated successfully.',
            });

            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow password changes' });
            await userEvent.click(toggle);

            await waitFor(() => {
                expect(adminService.updatePasswordChangeSettings).toHaveBeenCalledWith(false);
            });
            await waitFor(() => {
                expect(toggle).not.toBeChecked();
            });
            expect(mockRefreshSettings).toHaveBeenCalled();
        });

        it('shows an error and keeps the current state when the update fails', async () => {
            (jest.mocked(adminService.updatePasswordChangeSettings) as jest.Mock).mockRejectedValueOnce(
                new Error('network')
            );

            renderSettings();

            const toggle = await screen.findByRole('checkbox', { name: 'Allow password changes' });
            await userEvent.click(toggle);

            await waitFor(() => {
                expect(screen.getByText('Failed to update password change settings.')).toBeInTheDocument();
            });
            expect(toggle).toBeChecked();
            expect(mockRefreshSettings).not.toHaveBeenCalled();
        });
    });
});
