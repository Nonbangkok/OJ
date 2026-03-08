import { renderHook, waitFor, act } from '@testing-library/react';
import useContestDetail from '../../hooks/useContestDetail';
import contestService from '../../services/contestService';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// Mock dependencies
jest.mock('react-router-dom', () => ({
    useParams: jest.fn(),
    useNavigate: jest.fn()
}));

jest.mock('../../services/contestService');
jest.mock('../../context/AuthContext');

describe('useContestDetail Hook', () => {
    const mockNavigate = jest.fn();
    const mockUser = { id: 1, username: 'testuser' };

    beforeEach(() => {
        jest.clearAllMocks();
        useNavigate.mockReturnValue(mockNavigate);
        useAuth.mockReturnValue({ user: mockUser });
        useParams.mockReturnValue({ contestId: '123' });

        // Mock timers for interval testing
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('fetches contest data successfully on mount', async () => {
        const mockContest = {
            id: '123',
            title: 'Test Contest',
            status: 'scheduled',
            is_participant: false
        };
        contestService.getById.mockResolvedValue(mockContest);

        const { result } = renderHook(() => useContestDetail());

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.contest).toEqual(mockContest);
        expect(result.current.error).toBe('');
        expect(contestService.getById).toHaveBeenCalledWith('123');
    });

    it('redirects to scoreboard if contest is finished and user is participant', async () => {
        const mockContest = {
            id: '123',
            status: 'finished',
            is_participant: true
        };
        contestService.getById.mockResolvedValueOnce(mockContest);

        renderHook(() => useContestDetail());

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/contests/123/scoreboard');
        });
    });

    it('redirects to contests list if contest is finished and user is NOT participant', async () => {
        const mockContest = {
            id: '123',
            status: 'finished',
            is_participant: false
        };
        contestService.getById.mockResolvedValueOnce(mockContest);

        renderHook(() => useContestDetail());

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/contests');
        });
    });

    it('handles 403 error (needs to join)', async () => {
        const error = new Error('Forbidden');
        error.response = { status: 403 };
        contestService.getById.mockRejectedValueOnce(error);

        const { result } = renderHook(() => useContestDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('You need to join this contest to view its details.');
    });

    it('handles 404 error (not found)', async () => {
        const error = new Error('Not Found');
        error.response = { status: 404 };
        contestService.getById.mockRejectedValueOnce(error);

        const { result } = renderHook(() => useContestDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Contest not found.');
    });

    it('handles general fetch error', async () => {
        const error = new Error('Network Error');
        contestService.getById.mockRejectedValueOnce(error);

        const { result } = renderHook(() => useContestDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Failed to load contest data.');
    });

    it('handles joining contest successfully', async () => {
        const mockContest = { id: '123', is_participant: false };
        const updatedContest = { id: '123', is_participant: true };

        contestService.getById.mockResolvedValueOnce(mockContest);
        contestService.join.mockResolvedValueOnce({});
        contestService.getById.mockResolvedValueOnce(updatedContest);

        const { result } = renderHook(() => useContestDetail());

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleJoinContest();
        });

        expect(contestService.join).toHaveBeenCalledWith('123');
        expect(result.current.contest).toEqual(updatedContest);
        expect(result.current.joining).toBe(false);
    });

    it('handles joining contest failure', async () => {
        const mockContest = { id: '123', is_participant: false };
        contestService.getById.mockResolvedValueOnce(mockContest);

        const error = new Error('Join failed');
        error.response = { data: { message: 'Too late to join' } };
        contestService.join.mockRejectedValueOnce(error);

        window.alert = jest.fn();

        const { result } = renderHook(() => useContestDetail());

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleJoinContest();
        });

        expect(window.alert).toHaveBeenCalledWith('Too late to join');
        expect(result.current.joining).toBe(false);
    });

    it('polls for data every 15 seconds', async () => {
        contestService.getById.mockResolvedValue({ id: '123', status: 'running' });

        renderHook(() => useContestDetail());

        await waitFor(() => expect(contestService.getById).toHaveBeenCalledTimes(1));

        // Advance timers by 15 seconds
        act(() => {
            jest.advanceTimersByTime(15000);
        });

        await waitFor(() => expect(contestService.getById).toHaveBeenCalledTimes(2));

        // Advance another 15 seconds
        act(() => {
            jest.advanceTimersByTime(15000);
        });

        await waitFor(() => expect(contestService.getById).toHaveBeenCalledTimes(3));
    });

    it('clears interval on unmount', () => {
        const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
        const { unmount } = renderHook(() => useContestDetail());

        unmount();
        expect(clearIntervalSpy).toHaveBeenCalled();
    });
});
