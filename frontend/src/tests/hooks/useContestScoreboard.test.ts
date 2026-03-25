import { renderHook, waitFor, act } from '@testing-library/react';
import useContestScoreboard from '../../hooks/useContestScoreboard';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');

describe('useContestScoreboard', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    const mockContestId = '1';
    const mockContest = { id: 1, title: 'Test Contest', status: 'finished' };
    const mockScoreboardData = {
        scoreboard: [
            { user_id: 1, username: 'user1', total_score: 100, detailed_scores: { 1: 100 } }
        ],
        problems: [{ problem_id: 1 }]
    };

    it('fetches contest data and scoreboard on mount', async () => {
        (jest.mocked(contestService.getById) as jest.Mock).mockResolvedValueOnce(mockContest);
        (jest.mocked(contestService.getScoreboard) as jest.Mock).mockResolvedValueOnce(mockScoreboardData);

        const { result } = renderHook(() => useContestScoreboard(mockContestId));

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.contest).toEqual(mockContest);
        expect(result.current.scoreboard).toEqual(mockScoreboardData.scoreboard);
        expect(result.current.problems).toEqual(mockScoreboardData.problems);
        expect(result.current.error).toBe('');
        expect(result.current.lastUpdate).toBeInstanceOf(Date);
    });

    it('handles API errors correctly (404 Not Found)', async () => {
        const error404 = { response: { status: 404 } };
        (jest.mocked(contestService.getById) as jest.Mock).mockRejectedValueOnce(error404);
        (jest.mocked(contestService.getScoreboard) as jest.Mock).mockRejectedValueOnce(error404);

        const { result } = renderHook(() => useContestScoreboard(mockContestId));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Contest not found.');
        expect(result.current.contest).toBeNull();
    });

    it('handles getProblemScore correctly', () => {
        const { result } = renderHook(() => useContestScoreboard(mockContestId));

        // Old format (number)
        const oldScore = result.current.getProblemScore({ 1: 100 }, '1');
        expect(oldScore).toEqual({ score: 100, attempts: 1, solved: true });

        // New format (object)
        const newScore = result.current.getProblemScore({ 2: { score: 50, attempts: 2 } }, '2');
        expect(newScore).toEqual({ score: 50, attempts: 2, solved: false });

        // Missing problem
        expect(result.current.getProblemScore({ 1: 100 }, '2')).toBeNull();
    });
});
