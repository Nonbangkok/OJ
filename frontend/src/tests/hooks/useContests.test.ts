import { renderHook, waitFor } from '@testing-library/react';
import { useContests } from '../../hooks/useContests';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');

describe('useContests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should fetch and return contests on mount', async () => {
        const mockContests = [{ id: 1, title: 'Test Contest' }];
        (jest.mocked(contestService.getAll) as jest.Mock).mockResolvedValue(mockContests);

        const { result } = renderHook(() => useContests());

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.contests).toEqual(mockContests);
        expect(result.current.error).toBe('');
        expect(contestService.getAll).toHaveBeenCalledTimes(1);
    });

    it('should handle errors when fetching contests', async () => {
        (jest.mocked(contestService.getAll) as jest.Mock).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useContests());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.contests).toEqual([]);
        expect(result.current.error).toBe('Failed to load contests');
    });

    it('should join a contest successfully', async () => {
        const mockContests = [{ id: 1, title: 'Test Contest' }];
        (jest.mocked(contestService.getAll) as jest.Mock).mockResolvedValue(mockContests);
        (jest.mocked(contestService.join) as jest.Mock).mockResolvedValue({});

        const { result } = renderHook(() => useContests());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        let joinResult;
        await waitFor(async () => {
            joinResult = await result.current.joinContest(1);
        });

        expect(joinResult.success).toBe(true);
        expect(contestService.join).toHaveBeenCalledWith(1);
    });

    it('should handle join contest error', async () => {
        const mockContests = [{ id: 1, title: 'Test Contest' }];
        (jest.mocked(contestService.getAll) as jest.Mock).mockResolvedValue(mockContests);
        (jest.mocked(contestService.join) as jest.Mock).mockRejectedValue({
            response: { data: { message: 'Contest full' } }
        });

        const { result } = renderHook(() => useContests());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        let joinResult;
        await waitFor(async () => {
            joinResult = await result.current.joinContest(1);
        });

        expect(joinResult.success).toBe(false);
        expect(joinResult.message).toBe('Contest full');
    });
});
