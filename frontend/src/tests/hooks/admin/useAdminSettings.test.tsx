import { renderHook, waitFor, act } from '@testing-library/react';
import useAdminSettings from '../../../hooks/admin/useAdminSettings';
import adminService from '../../../services/adminService';
import { SettingsContext } from '../../../context/SettingsContext';
import React from 'react';

jest.mock('../../../services/adminService');

describe('useAdminSettings', () => {
    const mockRefreshSettings = jest.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <SettingsContext.Provider value={{ refreshSettings: mockRefreshSettings, isLoading: false, registrationEnabled: true, accessMode: 'public', passwordChangeEnabled: true, isPrivateMode: false }}>
            {children}
        </SettingsContext.Provider>
    );

    beforeEach(() => {
        jest.clearAllMocks();
        // Default mocks
        (jest.mocked(adminService.getRegistrationSettings) as jest.Mock).mockResolvedValue({ enabled: true });
        (jest.mocked(adminService.getPasswordChangeSettings) as jest.Mock).mockResolvedValue({ enabled: true });
    });

    it('fetches registration status on mount', async () => {
        const { result } = renderHook(() => useAdminSettings(), { wrapper });

        expect(result.current.isLoadingRegistration).toBe(true);

        await waitFor(() => {
            expect(result.current.isLoadingRegistration).toBe(false);
        });

        expect(result.current.isRegistrationEnabled).toBe(true);
        expect(adminService.getRegistrationSettings).toHaveBeenCalledTimes(1);
    });

    it('handles toggle registration', async () => {
        (jest.mocked(adminService.updateRegistrationSettings) as jest.Mock).mockResolvedValueOnce({ message: 'Success', enabled: false });

        const { result } = renderHook(() => useAdminSettings(), { wrapper });

        await waitFor(() => expect(result.current.isLoadingRegistration).toBe(false));

        await act(async () => {
            await result.current.handleRegistrationToggle();
        });

        expect(adminService.updateRegistrationSettings).toHaveBeenCalledWith(false);
        expect(result.current.isRegistrationEnabled).toBe(false);
        expect(mockRefreshSettings).toHaveBeenCalled();
    });

    it('fetches the password change setting on mount', async () => {
        (jest.mocked(adminService.getPasswordChangeSettings) as jest.Mock).mockResolvedValue({ enabled: false });

        const { result } = renderHook(() => useAdminSettings(), { wrapper });

        await waitFor(() => expect(result.current.isPasswordChangeEnabled).toBe(false));
        expect(adminService.getPasswordChangeSettings).toHaveBeenCalledTimes(1);
    });

    it('handles toggling the password change setting', async () => {
        (jest.mocked(adminService.updatePasswordChangeSettings) as jest.Mock).mockResolvedValueOnce({
            message: 'Password change setting updated successfully.',
        });

        const { result } = renderHook(() => useAdminSettings(), { wrapper });

        await waitFor(() => expect(result.current.isLoadingRegistration).toBe(false));

        await act(async () => {
            await result.current.handlePasswordChangeToggle();
        });

        expect(adminService.updatePasswordChangeSettings).toHaveBeenCalledWith(false);
        expect(result.current.isPasswordChangeEnabled).toBe(false);
        expect(mockRefreshSettings).toHaveBeenCalled();
    });

    it('handles database export', async () => {
        const mockData = new Blob(['dummy content'], { type: 'application/sql' });
        (jest.mocked(adminService.exportDatabase) as jest.Mock).mockResolvedValueOnce({
            data: mockData,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { headers: {} }
        });

        // Mock URL.createObjectURL and other DOM APIs
        window.URL.createObjectURL = jest.fn(() => 'mock-url');
        window.URL.revokeObjectURL = jest.fn();

        const { result } = renderHook(() => useAdminSettings(), { wrapper });
        await waitFor(() => expect(result.current.isLoadingRegistration).toBe(false));

        await act(async () => {
            await result.current.handleExportDatabase();
        });

        expect(adminService.exportDatabase).toHaveBeenCalled();
        expect(result.current.databaseSuccess).toBe('Database exported successfully!');
    });

    describe('database import progress polling (A2-07)', () => {
        const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: {} } });

        const startImport = async () => {
            const hook = renderHook(() => useAdminSettings(), { wrapper });
            await waitFor(() => expect(hook.result.current.isLoadingRegistration).toBe(false));
            act(() => {
                hook.result.current.selectDatabaseFile(new File(['--'], 'backup.sql'));
            });
            await act(async () => {
                await hook.result.current.handleImportDatabase();
            });
            return hook;
        };

        /** Let the poll scheduled `ms` from now run, including its awaited request. */
        const advance = async (ms: number) => {
            await act(async () => {
                await jest.advanceTimersByTimeAsync(ms);
            });
        };

        beforeEach(() => {
            jest.useFakeTimers();
            (jest.mocked(adminService.importDatabase) as jest.Mock).mockResolvedValue({ jobId: 'job-1', token: 'token-1' });
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('stops spinning and reports the problem after repeated poll failures', async () => {
            (jest.mocked(adminService.getImportDatabaseProgress) as jest.Mock).mockRejectedValue(new Error('Network Error'));

            const { result } = await startImport();
            expect(result.current.isImporting).toBe(true);
            await advance(60_000);

            expect(result.current.isImporting).toBe(false);
            expect(result.current.databaseError).toMatch(/lost contact with the server/i);
            const polls = (adminService.getImportDatabaseProgress as jest.Mock).mock.calls.length;
            await advance(60_000);
            expect((adminService.getImportDatabaseProgress as jest.Mock).mock.calls.length).toBe(polls);
        });

        it('stops at once when the server no longer knows the import job (404)', async () => {
            (jest.mocked(adminService.getImportDatabaseProgress) as jest.Mock).mockRejectedValue(httpError(404));

            const { result } = await startImport();
            await advance(0);

            expect(result.current.isImporting).toBe(false);
            expect(result.current.databaseError).toMatch(/import status is no longer available/i);
            expect(adminService.getImportDatabaseProgress).toHaveBeenCalledTimes(1);
        });

        it('keeps polling through a transient failure and reports completion', async () => {
            (jest.mocked(adminService.getImportDatabaseProgress) as jest.Mock)
                .mockRejectedValueOnce(httpError(502))
                .mockResolvedValueOnce({ status: 'uploading', message: 'Importing database dump.' })
                .mockResolvedValueOnce({ status: 'completed', message: 'Database imported successfully.' });

            const { result } = await startImport();
            await advance(60_000);

            expect(result.current.isImporting).toBe(false);
            expect(result.current.databaseError).toBe('');
            expect(adminService.getImportDatabaseProgress).toHaveBeenCalledTimes(3);
        });

        it('shows a failed import as an error', async () => {
            (jest.mocked(adminService.getImportDatabaseProgress) as jest.Mock)
                .mockResolvedValueOnce({ status: 'failed', message: 'Failed to import database; the previous database was restored.' });

            const { result } = await startImport();
            await advance(0);

            expect(result.current.isImporting).toBe(false);
            expect(result.current.databaseError).toBe('Failed to import database; the previous database was restored.');
        });
    });
});
