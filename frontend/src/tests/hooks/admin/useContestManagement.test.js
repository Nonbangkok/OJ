import { renderHook, waitFor, act } from '@testing-library/react';
import useContestManagement from '../../../hooks/admin/useContestManagement';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useContestManagement', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockContests = [
        { id: 1, title: 'Contest 1', status: 'scheduled' },
        { id: 2, title: 'Contest 2', status: 'running' }
    ];

    it('fetches contests on mount', async () => {
        adminService.getContests.mockResolvedValueOnce(mockContests);

        const { result } = renderHook(() => useContestManagement());

        expect(result.current.loading).toBe(true);
        expect(result.current.contests).toEqual([]);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.contests).toEqual(mockContests);
        expect(adminService.getContests).toHaveBeenCalledTimes(1);
    });

    it('handles API errors when fetching', async () => {
        adminService.getContests.mockRejectedValueOnce(new Error('Fetch Failed'));

        const { result } = renderHook(() => useContestManagement());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Failed to load contests');
    });

    it('handles contest deletion', async () => {
        adminService.getContests.mockResolvedValueOnce(mockContests);
        adminService.deleteContest.mockResolvedValueOnce({});

        const { result } = renderHook(() => useContestManagement());

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Set the contest to delete
        act(() => {
            result.current.setContestToDelete(1);
        });

        await act(async () => {
            await result.current.handleDelete();
        });

        expect(adminService.deleteContest).toHaveBeenCalledWith(1);
        // Should re-fetch
        expect(adminService.getContests).toHaveBeenCalledTimes(2);
    });
});
