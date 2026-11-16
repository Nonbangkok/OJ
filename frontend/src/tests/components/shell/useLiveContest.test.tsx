import { act, renderHook, waitFor } from '@testing-library/react';
import { useLiveContest } from '../../../components/shell/useLiveContest';
import contestService from '../../../services/contestService';
import { useAuth } from '../../../context/AuthContext';
import type { Contest } from '../../../types';

jest.mock('../../../services/contestService', () => ({ __esModule: true, default: { getAll: jest.fn() } }));
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const contest = (id: number, status: Contest['status'], endInMinutes: number): Contest => ({
  id, title: `C${id}`, description: null, status,
  start_time: new Date(Date.now() - 3_600_000).toISOString(),
  end_time: new Date(Date.now() + endInMinutes * 60_000).toISOString(),
});

describe('useLiveContest', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'u', role: 'user' } } as ReturnType<typeof useAuth>);
  });
  afterEach(() => jest.useRealTimers());

  it('pins the running contest that ends soonest', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([contest(1, 'running', 180), contest(2, 'running', 60), contest(3, 'scheduled', 600)]);
    const { result } = renderHook(() => useLiveContest());
    await waitFor(() => expect(result.current?.id).toBe(2));
  });

  it('is null when nothing is running', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([contest(3, 'scheduled', 600)]);
    const { result } = renderHook(() => useLiveContest());
    await waitFor(() => expect(contestService.getAll).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('is null when the request fails', async () => {
    jest.mocked(contestService.getAll).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useLiveContest());
    await waitFor(() => expect(contestService.getAll).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('refetches every minute', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([]);
    renderHook(() => useLiveContest());
    await waitFor(() => expect(contestService.getAll).toHaveBeenCalledTimes(1));
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(contestService.getAll).toHaveBeenCalledTimes(2);
  });

  it('does not fetch for guests', () => {
    jest.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
    renderHook(() => useLiveContest());
    expect(contestService.getAll).not.toHaveBeenCalled();
  });
});
