import { renderHook, waitFor } from '@testing-library/react';
import { useScoreboard } from '../../hooks/useScoreboard';
import scoreboardService from '../../services/scoreboardService';

jest.mock('../../services/scoreboardService');

describe('useScoreboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should fetch and return scoreboard on mount', async () => {
        const mockScoreboard = [
            { username: 'user1', problems_solved: 5, total_score: 500 },
            { username: 'user2', problems_solved: 3, total_score: 300 }
        ];
        (jest.mocked(scoreboardService.getGlobal) as jest.Mock).mockResolvedValue(mockScoreboard);

        const { result } = renderHook(() => useScoreboard());

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.scoreboard).toEqual(mockScoreboard);
        expect(result.current.error).toBe('');
        expect(scoreboardService.getGlobal).toHaveBeenCalledTimes(1);
    });

    it('should handle errors when fetching scoreboard', async () => {
        (jest.mocked(scoreboardService.getGlobal) as jest.Mock).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useScoreboard());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.scoreboard).toEqual([]);
        expect(result.current.error).toBe('Failed to fetch scoreboard. Please log in.');
    });
});
