import { renderHook, waitFor, act } from '@testing-library/react';
import useAdminSettings from '../../../hooks/admin/useAdminSettings';
import adminService from '../../../services/adminService';
import { SettingsContext } from '../../../context/SettingsContext';
import React from 'react';

jest.mock('../../../services/adminService');

describe('useAdminSettings', () => {
    const mockRefreshSettings = jest.fn();
    const wrapper = ({ children }) => (
        <SettingsContext.Provider value={{ refreshSettings: mockRefreshSettings }}>
            {children}
        </SettingsContext.Provider>
    );

    beforeEach(() => {
        jest.clearAllMocks();
        // Default mocks
        adminService.getRegistrationSettings.mockResolvedValue({ enabled: true });
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
        adminService.updateRegistrationSettings.mockResolvedValueOnce({ message: 'Success' });

        const { result } = renderHook(() => useAdminSettings(), { wrapper });

        await waitFor(() => expect(result.current.isLoadingRegistration).toBe(false));

        await act(async () => {
            await result.current.handleRegistrationToggle();
        });

        expect(adminService.updateRegistrationSettings).toHaveBeenCalledWith(false);
        expect(result.current.isRegistrationEnabled).toBe(false);
        expect(mockRefreshSettings).toHaveBeenCalled();
    });

    it('handles database export', async () => {
        const mockData = new Blob(['dummy content'], { type: 'application/sql' });
        adminService.exportDatabase.mockResolvedValueOnce({ data: mockData });

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
});
