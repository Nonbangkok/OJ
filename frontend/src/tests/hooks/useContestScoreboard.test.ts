import { renderHook, waitFor, act } from '@testing-library/react';
import useContestScoreboard from '../../hooks/useContestScoreboard';
import contestService from '../../services/contestService';
import {
  isRealtimeSupported,
  subscribeScoreboard,
} from '../../services/realtimeService';
import { REALTIME } from '../../config/constants';

jest.mock('../../services/contestService');
jest.mock('../../services/realtimeService', () => ({
  isRealtimeSupported: jest.fn(() => true),
  subscribeSubmissions: jest.fn(() => jest.fn()),
  subscribeScoreboard: jest.fn(() => jest.fn()),
}));

type ScoreboardListener = Parameters<typeof subscribeScoreboard>[1];
type SubscribeOptions = Parameters<typeof subscribeScoreboard>[2];

const lastSubscribeCall = (): {
  listener: ScoreboardListener;
  options: SubscribeOptions | undefined;
} => {
  const calls = (jest.mocked(subscribeScoreboard) as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [contestId, listener, options] = calls[calls.length - 1];
  return { listener, options };
};

describe('useContestScoreboard', () => {
    // Auto-mocks reset between tests (react-scripts sets resetMocks), so the
    // realtime service implementations must be (re)installed before each test.
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(isRealtimeSupported) as jest.Mock).mockReturnValue(true);
        (jest.mocked(subscribeScoreboard) as jest.Mock).mockImplementation(() => jest.fn());
    });

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

    describe('realtime (SSE)', () => {
        const runningContest = { ...mockContest, status: 'running' };
        const getScoreboardCalls = () =>
            (jest.mocked(contestService.getScoreboard) as jest.Mock).mock.calls.length;

        it('does not subscribe without a contest id', async () => {
            (jest.mocked(contestService.getById) as jest.Mock).mockResolvedValueOnce(mockContest);
            (jest.mocked(contestService.getScoreboard) as jest.Mock).mockResolvedValueOnce(mockScoreboardData);

            const { result } = renderHook(() => useContestScoreboard(undefined));
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(subscribeScoreboard).not.toHaveBeenCalled();
        });

        it('subscribes with the contest id and refetches on every event', async () => {
            (jest.mocked(contestService.getById) as jest.Mock).mockResolvedValueOnce(runningContest);
            (jest.mocked(contestService.getScoreboard) as jest.Mock).mockResolvedValueOnce(mockScoreboardData);

            const { result } = renderHook(() => useContestScoreboard(mockContestId));
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(subscribeScoreboard).toHaveBeenCalledTimes(1);
            expect((jest.mocked(subscribeScoreboard) as jest.Mock).mock.calls[0][0]).toBe(mockContestId);
            const callsBefore = getScoreboardCalls();

            const { listener } = lastSubscribeCall();
            act(() => {
                listener({ type: 'scoreboard_update', contestId: 1 });
            });

            await waitFor(() => expect(getScoreboardCalls()).toBeGreaterThan(callsBefore));
        });

        it('subscribes even for a finished contest (final migration event)', async () => {
            (jest.mocked(contestService.getById) as jest.Mock).mockResolvedValueOnce(mockContest);
            (jest.mocked(contestService.getScoreboard) as jest.Mock).mockResolvedValueOnce(mockScoreboardData);

            const { result } = renderHook(() => useContestScoreboard(mockContestId));
            await waitFor(() => expect(result.current.loading).toBe(false));

            // The subscription is status-independent by design: the
            // post-contest migration emits after the contest ends.
            expect(subscribeScoreboard).toHaveBeenCalledTimes(1);
        });

        it('uses the slow fallback interval while the stream is up', async () => {
            jest.useFakeTimers();
            try {
                (jest.mocked(contestService.getById) as jest.Mock).mockResolvedValue(runningContest);
                (jest.mocked(contestService.getScoreboard) as jest.Mock).mockResolvedValue(mockScoreboardData);

                const { result } = renderHook(() => useContestScoreboard(mockContestId));
                await act(async () => {});
                expect(result.current.loading).toBe(false);

                const callsBefore = getScoreboardCalls();

                // Not yet a full fallback interval.
                act(() => {
                    jest.advanceTimersByTime(REALTIME.SCOREBOARD_POLL_WHEN_STREAM_DOWN_MS);
                });
                expect(getScoreboardCalls()).toBe(callsBefore);

                // A full fallback interval fires the safety-net poll.
                act(() => {
                    jest.advanceTimersByTime(REALTIME.SCOREBOARD_FALLBACK_POLL_MS);
                });
                expect(getScoreboardCalls()).toBeGreaterThan(callsBefore);
            } finally {
                jest.useRealTimers();
            }
        });

        it('reverts to the fast interval when the stream dies for good', async () => {
            jest.useFakeTimers();
            try {
                (jest.mocked(contestService.getById) as jest.Mock).mockResolvedValue(runningContest);
                (jest.mocked(contestService.getScoreboard) as jest.Mock).mockResolvedValue(mockScoreboardData);

                const { result } = renderHook(() => useContestScoreboard(mockContestId));
                await act(async () => {});
                expect(result.current.loading).toBe(false);

                const { options } = lastSubscribeCall();
                act(() => {
                    options?.onStreamDown?.();
                });

                const callsBefore = getScoreboardCalls();
                act(() => {
                    jest.advanceTimersByTime(REALTIME.SCOREBOARD_POLL_WHEN_STREAM_DOWN_MS);
                });
                expect(getScoreboardCalls()).toBeGreaterThan(callsBefore);
            } finally {
                jest.useRealTimers();
            }
        });

        it('does not subscribe when EventSource is unavailable', async () => {
            (jest.mocked(isRealtimeSupported) as jest.Mock).mockReturnValue(false);
            (jest.mocked(contestService.getById) as jest.Mock).mockResolvedValueOnce(runningContest);
            (jest.mocked(contestService.getScoreboard) as jest.Mock).mockResolvedValueOnce(mockScoreboardData);

            const { result } = renderHook(() => useContestScoreboard(mockContestId));
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(subscribeScoreboard).not.toHaveBeenCalled();
        });
    });
});
