import { renderHook, act, waitFor } from '@testing-library/react';
import { useProblems } from '../../hooks/useProblems';
import problemService from '../../services/problemService';
import contestService from '../../services/contestService';

jest.mock('../../services/problemService');
jest.mock('../../services/contestService');

describe('useProblems', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should fetch and return problems on mount', async () => {
        const mockProblems = [{ id: 1, title: 'Test Problem' }];
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValue(mockProblems);

        const { result } = renderHook(() => useProblems());

        expect(result.current.loading).toBe(true);
        expect(result.current.problems).toEqual([]);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.problems).toEqual(mockProblems);
        expect(result.current.error).toBe('');
        expect(problemService.getAllWithStats).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully when fetching problems', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useProblems());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.problems).toEqual([]);
        expect(result.current.error).toBe('Failed to fetch problems. Please log in.');
    });

    it('should fetch contest problems when contestId is provided', async () => {
        const mockContestProblems = [{ id: 1, title: 'Contest Problem' }];
        (jest.mocked(contestService.getProblems) as jest.Mock).mockResolvedValue(mockContestProblems);

        const { result } = renderHook(() => useProblems('contest-123'));

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.problems).toEqual(mockContestProblems);
        expect(result.current.error).toBe('');
        expect(contestService.getProblems).toHaveBeenCalledWith('contest-123');
        expect(problemService.getAllWithStats).not.toHaveBeenCalled();
    });

    it('should handle errors when fetching contest problems', async () => {
        (jest.mocked(contestService.getProblems) as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

        const { result } = renderHook(() => useProblems('contest-123'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.problems).toEqual([]);
        expect(result.current.error).toBe('Failed to fetch contest problems.');
    });

    it('should refresh problems when refresh is called', async () => {
        const mockProblems = [{ id: 1, title: 'Test Problem' }];
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValue(mockProblems);

        const { result } = renderHook(() => useProblems());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(problemService.getAllWithStats).toHaveBeenCalledTimes(1);

        await act(async () => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(problemService.getAllWithStats).toHaveBeenCalledTimes(2);
        expect(result.current.problems).toEqual(mockProblems);
    });

    it('should refetch when contestId changes', async () => {
        const mockProblems1 = [{ id: 1, title: 'Problem 1' }];
        const mockProblems2 = [{ id: 2, title: 'Problem 2' }];
        (jest.mocked(contestService.getProblems) as jest.Mock)
            .mockResolvedValueOnce(mockProblems1)
            .mockResolvedValueOnce(mockProblems2);

        const { result, rerender } = renderHook(
            ({ contestId }) => useProblems(contestId),
            { initialProps: { contestId: 'contest-1' } }
        );

        await waitFor(() => {
            expect(result.current.problems).toEqual(mockProblems1);
        });
        expect(contestService.getProblems).toHaveBeenCalledWith('contest-1');

        rerender({ contestId: 'contest-2' });

        await waitFor(() => {
            expect(result.current.problems).toEqual(mockProblems2);
        });
        expect(contestService.getProblems).toHaveBeenCalledWith('contest-2');
    });
});
