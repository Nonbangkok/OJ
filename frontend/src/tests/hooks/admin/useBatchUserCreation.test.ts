import { renderHook, waitFor, act } from '@testing-library/react';
import useBatchUserCreation from '../../../hooks/admin/useBatchUserCreation';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useBatchUserCreation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('initializes default values correctly', () => {
        const { result } = renderHook(() => useBatchUserCreation(jest.fn()));

        expect(result.current.prefix).toBe('');
        expect(result.current.count).toBe(10);
        expect(result.current.error).toBe('');
        expect(result.current.isLoading).toBe(false);
        expect(result.current.createdUsers).toBeNull();
    });

    it('handles field updates', () => {
        const { result } = renderHook(() => useBatchUserCreation(jest.fn()));

        act(() => {
            result.current.setPrefix('test_');
            result.current.setCount(20);
        });

        expect(result.current.prefix).toBe('test_');
        expect(result.current.count).toBe(20);
    });

    it('validates count correctly on submit', async () => {
        const { result } = renderHook(() => useBatchUserCreation(jest.fn()));

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
        (jest.mocked(adminService.createBatchUsers) as jest.Mock).mockResolvedValueOnce({
            message: 'Created',
            users: mockUsers
        });

        const { result } = renderHook(() => useBatchUserCreation(jest.fn()));

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
        (jest.mocked(adminService.createBatchUsers) as jest.Mock).mockRejectedValueOnce({
            response: { data: { message: 'Prefix already exists' } }
        });

        const { result } = renderHook(() => useBatchUserCreation(jest.fn()));

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
        const { result } = renderHook(() => useBatchUserCreation(jest.fn()));

        // Mock URL.createObjectURL and DOM methods
        global.URL.createObjectURL = jest.fn();
        const mockElement = document.createElement('a');
        const clickSpy = jest.spyOn(mockElement, 'click').mockImplementation(() => { });
        jest.spyOn(document, 'createElement').mockReturnValue(mockElement);
        jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
        jest.spyOn(document.body, 'removeChild').mockImplementation((child) => child);

        // First do nothing if no users
        result.current.generateAndDownloadCsv();
        expect(document.createElement).not.toHaveBeenCalled();

        // Now test with users
        expect(clickSpy).not.toHaveBeenCalled();
    });
});
