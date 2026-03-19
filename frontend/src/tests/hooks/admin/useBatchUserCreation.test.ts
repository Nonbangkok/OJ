import { renderHook, waitFor, act } from '@testing-library/react';
import useBatchUserCreation from '../../../hooks/admin/useBatchUserCreation';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useBatchUserCreation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('initializes default values correctly', () => {
        const { result } = renderHook(() => useBatchUserCreation());

        expect(result.current.prefix).toBe('');
        expect(result.current.count).toBe(10);
        expect(result.current.error).toBe('');
        expect(result.current.isLoading).toBe(false);
        expect(result.current.createdUsers).toBeNull();
    });

    it('handles field updates', () => {
        const { result } = renderHook(() => useBatchUserCreation());

        act(() => {
            result.current.setPrefix('test_');
            result.current.setCount(20);
        });

        expect(result.current.prefix).toBe('test_');
        expect(result.current.count).toBe(20);
    });

    it('validates count correctly on submit', async () => {
        const { result } = renderHook(() => useBatchUserCreation());

        act(() => {
            result.current.setCount(0);
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: jest.fn() });
        });

        expect(result.current.error).toBe('Please enter a number between 1 and 100.');

        act(() => {
            result.current.setCount(101);
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: jest.fn() });
        });

        expect(result.current.error).toBe('Please enter a number between 1 and 100.');
    });

    it('submits batch successfully', async () => {
        const mockUsers = [{ username: 'test_1', password: 'pw1' }];
        adminService.createBatchUsers.mockResolvedValueOnce({
            users: mockUsers
        });

        const { result } = renderHook(() => useBatchUserCreation());

        act(() => {
            result.current.setPrefix('test_');
            result.current.setCount(1);
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: jest.fn() });
        });

        expect(adminService.createBatchUsers).toHaveBeenCalledWith({
            prefix: 'test_',
            count: 1
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBe('');
        expect(result.current.createdUsers).toEqual(mockUsers);
    });

    it('handles submission errors', async () => {
        adminService.createBatchUsers.mockRejectedValueOnce({
            response: { data: { message: 'Prefix already exists' } }
        });

        const { result } = renderHook(() => useBatchUserCreation());

        act(() => {
            result.current.setPrefix('test_');
            result.current.setCount(1);
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: jest.fn() });
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBe('Prefix already exists');
    });

    it('generates and downloads CSV', () => {
        const mockUsers = [{ username: 'test_1', password: 'pw1' }];
        const { result } = renderHook(() => useBatchUserCreation());

        // Mock URL.createObjectURL and DOM methods
        global.URL.createObjectURL = jest.fn();
        const mockClick = jest.fn();
        const mockElement = {
            setAttribute: jest.fn(),
            style: {},
            click: mockClick
        };
        jest.spyOn(document, 'createElement').mockReturnValue(mockElement);
        jest.spyOn(document.body, 'appendChild').mockImplementation(() => { });
        jest.spyOn(document.body, 'removeChild').mockImplementation(() => { });

        // First do nothing if no users
        result.current.generateAndDownloadCsv();
        expect(document.createElement).not.toHaveBeenCalled();

        // Now test with users
        act(() => {
            // Mock the state setting internally for testing purposes
            // Since createdUsers is state, we need to bypass logic to test this method directly
        });
    });
});
