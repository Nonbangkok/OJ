import { act, renderHook, waitFor } from '@testing-library/react';
import useLiveSubmission from '../../../features/submission/useLiveSubmission';
import submissionService from '../../../services/submissionService';
import { subscribeSubmissions, type SubmissionUpdatePayload } from '../../../services/realtimeService';
import { POLLING_INTERVALS } from '../../../config/constants';

jest.mock('../../../services/submissionService');
jest.mock('../../../services/realtimeService', () => ({
  ...jest.requireActual('../../../services/realtimeService'),
  subscribeSubmissions: jest.fn(),
}));

const detail = (id: number, overall_status: string) => ({
  id, username: 'u', problem_id: 'p', overall_status, score: 0, language: 'cpp',
  submitted_at: '2026-11-16T00:00:00Z', code: '', max_time_ms: null, max_memory_kb: null, results: null,
});

describe('useLiveSubmission', () => {
  let push: (payload: SubmissionUpdatePayload) => void = () => undefined;
  let streamDown: () => void = () => undefined;

  beforeEach(() => {
    jest.mocked(subscribeSubmissions).mockImplementation((onUpdate, options) => {
      push = onUpdate;
      streamDown = options?.onStreamDown ?? (() => undefined);
      return () => undefined;
    });
  });
  afterEach(() => jest.useRealTimers());

  it('refetches on its own submission event only', async () => {
    jest.mocked(submissionService.getById)
      .mockResolvedValueOnce(detail(7, 'Running'))
      .mockResolvedValueOnce(detail(7, 'Accepted'));
    const { result } = renderHook(() => useLiveSubmission(7));
    await waitFor(() => expect(result.current.submission?.overall_status).toBe('Running'));

    act(() => push({ type: 'submission_update', submissionId: 99, table: 'submissions', overall_status: 'Accepted', score: 100, user_id: 1 }));
    expect(submissionService.getById).toHaveBeenCalledTimes(1);

    act(() => push({ type: 'submission_update', submissionId: 7, table: 'submissions', overall_status: 'Accepted', score: 100, user_id: 1 }));
    await waitFor(() => expect(result.current.submission?.overall_status).toBe('Accepted'));
    expect(submissionService.getById).toHaveBeenLastCalledWith(7, null);
  });

  it('polls while pending when the stream is down and stops at a final verdict', async () => {
    jest.useFakeTimers();
    jest.mocked(submissionService.getById)
      .mockResolvedValueOnce(detail(7, 'Pending'))
      .mockResolvedValueOnce(detail(7, 'Running'))
      .mockResolvedValueOnce(detail(7, 'Wrong Answer'));
    const { result } = renderHook(() => useLiveSubmission(7, '3'));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.submission?.overall_status).toBe('Pending');
    act(() => streamDown());

    await act(async () => { jest.advanceTimersByTime(POLLING_INTERVALS.SUBMISSIONS); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.submission?.overall_status).toBe('Running');
    await act(async () => { jest.advanceTimersByTime(POLLING_INTERVALS.SUBMISSIONS); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.submission?.overall_status).toBe('Wrong Answer');

    await act(async () => { jest.advanceTimersByTime(POLLING_INTERVALS.SUBMISSIONS * 4); });
    expect(submissionService.getById).toHaveBeenCalledTimes(3);
    expect(submissionService.getById).toHaveBeenLastCalledWith(7, '3');
  });

  it('does nothing without an id', () => {
    const { result } = renderHook(() => useLiveSubmission(null));
    expect(result.current).toEqual({ submission: null, error: null });
    expect(submissionService.getById).not.toHaveBeenCalled();
  });
});
