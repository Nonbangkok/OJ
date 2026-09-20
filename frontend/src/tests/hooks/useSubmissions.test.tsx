import { renderHook, act, waitFor } from '@testing-library/react';
import { useSubmissions } from '../../hooks/useSubmissions';
import submissionService from '../../services/submissionService';
import {
  isRealtimeSupported,
  subscribeSubmissions,
} from '../../services/realtimeService';
import { useAuth } from '../../context/AuthContext';
import { REALTIME, POLLING_INTERVALS } from '../../config/constants';

jest.mock('../../services/submissionService');
jest.mock('../../context/AuthContext');
jest.mock('../../services/realtimeService', () => ({
  isRealtimeSupported: jest.fn(() => true),
  subscribeSubmissions: jest.fn(() => jest.fn()),
  subscribeScoreboard: jest.fn(() => jest.fn()),
}));

type SubmissionsListener = Parameters<typeof subscribeSubmissions>[0];
type SubscribeOptions = Parameters<typeof subscribeSubmissions>[1];

const lastSubscribeCall = (): {
  listener: SubmissionsListener;
  options: SubscribeOptions | undefined;
} => {
  const calls = (jest.mocked(subscribeSubmissions) as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [listener, options] = calls[calls.length - 1];
  return { listener, options };
};

const mockAuth = (user: object | null) => {
    jest.mocked(useAuth).mockReturnValue({ user, isLoading: false } as ReturnType<typeof useAuth>);
};

describe('useSubmissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Auto-mocks reset between tests (react-scripts sets resetMocks), so
        // realtime service implementations must be (re)installed here.
        (jest.mocked(isRealtimeSupported) as jest.Mock).mockReturnValue(true);
        (jest.mocked(subscribeSubmissions) as jest.Mock).mockImplementation(
            () => jest.fn()
        );
        mockAuth(null);
        (jest.mocked(submissionService.searchProblems) as jest.Mock).mockResolvedValue([]);
        (jest.mocked(submissionService.searchUsers) as jest.Mock).mockResolvedValue([]);
    });

    it('fetches and returns submissions on mount', async () => {
        const mockSubmissions = [{ id: 1, overall_status: 'Accepted' }];
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions(undefined, undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.submissions).toEqual(mockSubmissions);
        expect(result.current.error).toBe('');
        expect(submissionService.getAll).toHaveBeenCalled();
    });

    it('handles errors when fetching submissions', async () => {
        (jest.mocked(submissionService.getAll) as jest.Mock).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useSubmissions(undefined, undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.submissions).toEqual([]);
        expect(result.current.error).toBe('Failed to fetch submissions.');
    });

    it('passes problemId and filter when problemId is provided', async () => {
        const mockSubmissions = [{ id: 1, problemId: 5 }];
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions(5, undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(submissionService.getAll).toHaveBeenCalledWith(
            expect.objectContaining({
                filter: 'mine',
                problemId: 5,
            })
        );
    });

    it('passes contestId when contestId is provided', async () => {
        const mockSubmissions = [];
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions(null, 'contest-123'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(submissionService.getAll).toHaveBeenCalledWith(
            expect.objectContaining({ contestId: 'contest-123' })
        );
    });

    it('refreshes submissions when refresh is called', async () => {
        const mockSubmissions = [{ id: 1 }];
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions(undefined, undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const callCount = jest.mocked(submissionService.getAll).mock.calls.length;

        await act(async () => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(jest.mocked(submissionService.getAll).mock.calls.length).toBeGreaterThan(callCount);
    });

    it('opens modal and fetches submission details when handleViewCode is called', async () => {
        const mockSubmissions = [];
        const mockSubmissionDetail = { id: 1, code: 'print("hello")' };
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue(mockSubmissions);
        (jest.mocked(submissionService.getById) as jest.Mock).mockResolvedValue(mockSubmissionDetail);

        const { result } = renderHook(() => useSubmissions(undefined, undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            result.current.handleViewCode(1);
        });

        expect(submissionService.getById).toHaveBeenCalledWith(1, undefined);
        expect(result.current.selectedSubmission).toEqual(mockSubmissionDetail);
        expect(result.current.isModalOpen).toBe(true);
    });

    it('closes modal when handleCloseModal is called', async () => {
        const mockSubmissions = [];
        const mockSubmissionDetail = { id: 1 };
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue(mockSubmissions);
        (jest.mocked(submissionService.getById) as jest.Mock).mockResolvedValue(mockSubmissionDetail);

        const { result } = renderHook(() => useSubmissions(undefined, undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            result.current.handleViewCode(1);
        });
        expect(result.current.isModalOpen).toBe(true);

        act(() => {
            result.current.handleCloseModal();
        });
        expect(result.current.isModalOpen).toBe(false);
        expect(result.current.selectedSubmission).toBe(null);
    });

    it('updates filter when setFilter is called', async () => {
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue([]);

        const { result } = renderHook(() => useSubmissions(undefined, undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.filter).toBe('all');

        act(() => {
            result.current.setFilter('mine');
        });
        expect(result.current.filter).toBe('mine');
    });

    it('returns initial state values', async () => {
        (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue([]);

        const { result } = renderHook(() => useSubmissions(undefined, undefined));

        expect(result.current.submissions).toEqual([]);
        expect(result.current.loading).toBe(true);
        expect(result.current.filter).toBe('all');
        expect(result.current.isModalOpen).toBe(false);
        expect(result.current.selectedSubmission).toBe(null);
    });

    describe('realtime (SSE)', () => {
        const mockUser = { id: 1, username: 'user1', role: 'user' };
        const getAllCalls = () =>
            (jest.mocked(submissionService.getAll) as jest.Mock).mock.calls.length;

        it('does not subscribe while unauthenticated', async () => {
            (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue([]);

            const { result } = renderHook(() => useSubmissions(undefined, undefined));
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(subscribeSubmissions).not.toHaveBeenCalled();
        });

        it('subscribes for a signed-in user and refetches on every event', async () => {
            mockAuth(mockUser);
            (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue([]);

            const { result } = renderHook(() => useSubmissions(undefined, undefined));
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(subscribeSubmissions).toHaveBeenCalledTimes(1);
            const initialCalls = getAllCalls();

            const { listener } = lastSubscribeCall();
            act(() => {
                listener({
                    type: 'submission_update',
                    submissionId: 1,
                    table: 'submissions',
                    overall_status: 'Accepted',
                    score: 100,
                    user_id: 1,
                });
            });

            await waitFor(() => {
                expect((jest.mocked(submissionService.getAll) as jest.Mock).mock.calls.length)
                    .toBeGreaterThan(initialCalls);
            });
        });

        it('uses the slow fallback interval while the stream is up', async () => {
            jest.useFakeTimers();
            try {
                mockAuth(mockUser);
                (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue([
                    { id: 1, overall_status: 'Pending' },
                ]);

                // waitFor advances fake timers itself, which would fire the
                // interval mid-wait; flush with a single act instead.
                const { result } = renderHook(() => useSubmissions(undefined, undefined));
                await act(async () => {});
                expect(result.current.loading).toBe(false);

                const callsBefore = getAllCalls();

                // Not yet a full fallback interval.
                act(() => {
                    jest.advanceTimersByTime(POLLING_INTERVALS.SUBMISSIONS);
                });
                expect(getAllCalls()).toBe(callsBefore);

                // A full fallback interval fires the safety-net poll.
                act(() => {
                    jest.advanceTimersByTime(REALTIME.SUBMISSIONS_FALLBACK_POLL_MS);
                });
                expect(getAllCalls()).toBeGreaterThan(callsBefore);
            } finally {
                jest.useRealTimers();
            }
        });

        it('restores the fast poll interval when the stream dies for good', async () => {
            jest.useFakeTimers();
            try {
                mockAuth(mockUser);
                (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue([
                    { id: 1, overall_status: 'Running' },
                ]);

                const { result } = renderHook(() => useSubmissions(undefined, undefined));
                await act(async () => {});
                expect(result.current.loading).toBe(false);

                const { options } = lastSubscribeCall();
                act(() => {
                    options?.onStreamDown?.();
                });

                const callsBefore = getAllCalls();
                act(() => {
                    jest.advanceTimersByTime(POLLING_INTERVALS.SUBMISSIONS);
                });
                expect(getAllCalls()).toBeGreaterThan(callsBefore);
            } finally {
                jest.useRealTimers();
            }
        });

        it('does not subscribe when EventSource is unavailable', async () => {
            (jest.mocked(isRealtimeSupported) as jest.Mock).mockReturnValue(false);
            (jest.mocked(submissionService.getAll) as jest.Mock).mockResolvedValue([]);

            const { result } = renderHook(() => useSubmissions(undefined, undefined));
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(subscribeSubmissions).not.toHaveBeenCalled();
        });
    });
});
