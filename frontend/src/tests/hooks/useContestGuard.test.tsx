import { renderHook, act } from '@testing-library/react';
import { useContestGuard } from '../../hooks/useContestGuard';
import { useNavigate } from 'react-router-dom';
import contestService from '../../services/contestService';

jest.mock('react-router-dom', () => ({
    useNavigate: jest.fn()
}));

jest.mock('../../services/contestService', () => ({
    getById: jest.fn()
}));

describe('useContestGuard Hook', () => {
    const contestId = 'contest-123';
    const mockNavigate = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        useNavigate.mockReturnValue(mockNavigate);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('successfully loads an ongoing contest', async () => {
        const mockContest = { id: contestId, status: 'ongoing', is_participant: true };
        contestService.getById.mockResolvedValueOnce(mockContest);

        const { result } = renderHook(() => useContestGuard(contestId));

        expect(result.current.loading).toBe(true);

        await act(async () => {
            // Wait for initial fetch
        });

        expect(result.current.loading).toBe(false);
        expect(result.current.isAccessible).toBe(true);
        expect(result.current.contest).toEqual(mockContest);
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('redirects to scoreboard if contest is finished and user is participant', async () => {
        const mockContest = { id: contestId, status: 'finished', is_participant: true };
        contestService.getById.mockResolvedValueOnce(mockContest);

        renderHook(() => useContestGuard(contestId));

        await act(async () => {
            // Wait for initial fetch
        });

        expect(mockNavigate).toHaveBeenCalledWith(`/contests/${contestId}/scoreboard`);
    });

    it('redirects to contests list if contest is finished and user is NOT participant', async () => {
        const mockContest = { id: contestId, status: 'finished', is_participant: false };
        contestService.getById.mockResolvedValueOnce(mockContest);

        renderHook(() => useContestGuard(contestId));

        await act(async () => {
            // Wait for initial fetch
        });

        expect(mockNavigate).toHaveBeenCalledWith('/contests');
    });

    it('handles 403 Forbidden error', async () => {
        const error = new Error('Forbidden');
        error.response = { status: 403 };
        contestService.getById.mockRejectedValueOnce(error);
        // Second call for status check in 403 handler
        contestService.getById.mockResolvedValueOnce({ status: 'ongoing' });

        const { result } = renderHook(() => useContestGuard(contestId));

        await act(async () => {
            // Wait for fetch and error handling
        });

        expect(result.current.error).toBe('You may not have access to this contest.');
        expect(result.current.isAccessible).toBe(false);
    });

    it('handles 404 Not Found error', async () => {
        const error = new Error('Not Found');
        error.response = { status: 404 };
        contestService.getById.mockRejectedValueOnce(error);

        const { result } = renderHook(() => useContestGuard(contestId));

        await act(async () => {
            // Wait for fetch and error handling
        });

        expect(result.current.error).toBe('Contest not found.');
    });

    it('polls contest status every 15 seconds', async () => {
        const mockContest = { id: contestId, status: 'ongoing' };
        contestService.getById.mockResolvedValue(mockContest);

        renderHook(() => useContestGuard(contestId));

        await act(async () => {
            // Initial call
        });

        expect(contestService.getById).toHaveBeenCalledTimes(1);

        // Advance timers by 15 seconds
        await act(async () => {
            jest.advanceTimersByTime(15000);
        });

        expect(contestService.getById).toHaveBeenCalledTimes(2);
    });
});
