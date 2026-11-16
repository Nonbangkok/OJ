import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import ContestLayout from '../../../features/contest/ContestLayout';
import { useContest } from '../../../features/contest/ContestContext';
import contestService from '../../../services/contestService';
import type { Contest } from '../../../types';

jest.mock('../../../services/contestService', () => ({ __esModule: true, default: { getById: jest.fn(), getProblems: jest.fn() } }));
jest.mock('../../../services/realtimeService', () => ({ subscribeSubmissions: () => () => undefined }));
jest.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, username: 'n', role: 'user', hasAvatar: false } }) }));
jest.mock('../../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }) }));
jest.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ passwordChangeEnabled: true }) }));
jest.mock('../../../components/shell/AppShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div><nav aria-label="Main" />{children}</div>,
}));

const contest = (over: Partial<Contest> = {}): Contest => ({
  id: 3, title: 'Midterm Practice', description: null, status: 'running', is_participant: true,
  start_time: new Date(Date.now() - 3_600_000).toISOString(),
  end_time: new Date(Date.now() + 90 * 60_000).toISOString(),
  ...over,
});

const Page = () => {
  const { contest: current } = useContest();
  return <p>{`page ${current?.title ?? ''} ${current?.status ?? ''}`.trim()}</p>;
};

const renderAt = (path = '/contests/3') =>
  render(
    <RouterProvider
      router={createMemoryRouter(
        [{ path: '/contests/:contestId', element: <ContestLayout />, children: [{ index: true, element: <Page /> }, { path: '*', element: <Page /> }] }],
        { initialEntries: [path] },
      )}
    />,
  );

describe('ContestLayout', () => {
  beforeEach(() => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
    jest.mocked(contestService.getById).mockReset();
    jest.mocked(contestService.getProblems).mockResolvedValue([] as never);
  });

  it('participant + running → ContestShell', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    renderAt();
    expect(await screen.findByRole('navigation', { name: 'Contest' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByText(/^page Midterm Practice/)).toBeInTheDocument();
  });

  it('participant + finishing → ContestShell', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest({ status: 'finishing', end_time: new Date(Date.now() - 1000).toISOString() }));
    renderAt();
    expect(await screen.findByRole('navigation', { name: 'Contest' })).toBeInTheDocument();
  });

  it('non-participant + running → AppShell', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest({ is_participant: false }));
    renderAt();
    expect(await screen.findByText(/^page Midterm Practice/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Contest' })).toBeNull();
  });

  it.each([
    ['scheduled', { status: 'scheduled' as const, start_time: new Date(Date.now() + 3_600_000).toISOString() }],
    ['finished', { status: 'finished' as const, end_time: new Date(Date.now() - 3_600_000).toISOString() }],
  ])('%s → AppShell for everyone, participants included', async (_label, over) => {
    jest.mocked(contestService.getById).mockResolvedValue(contest(over));
    renderAt();
    expect(await screen.findByText(/^page Midterm Practice/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Contest' })).toBeNull();
  });

  it('hidden contest 404 → "Contest not found."', async () => {
    jest.mocked(contestService.getById).mockRejectedValue({ response: { status: 404 } });
    renderAt();
    expect(await screen.findByText('Contest not found.')).toBeInTheDocument();
    expect(screen.queryByText(/^page/)).toBeNull();
  });

  it('contest fetched once for shell + page', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    renderAt('/contests/3/scoreboard');
    await screen.findByText(/^page Midterm Practice/);
    expect(contestService.getById).toHaveBeenCalledTimes(1);
  });

  it('reloads the contest when its start time passes', async () => {
    jest.useFakeTimers();
    jest.mocked(contestService.getById).mockResolvedValue(contest({ status: 'scheduled', start_time: new Date(Date.now() + 2000).toISOString() }));
    renderAt();
    await act(async () => { await Promise.resolve(); });
    const before = jest.mocked(contestService.getById).mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(jest.mocked(contestService.getById).mock.calls.length).toBeGreaterThan(before);
    jest.useRealTimers();
  });

  it('keeps asking after the end until the contest is finished, so an open tab reaches the recap', async () => {
    jest.useFakeTimers();
    const ended = new Date(Date.now() - 1000).toISOString();
    jest.mocked(contestService.getById)
      .mockResolvedValueOnce(contest({ end_time: ended }))
      .mockResolvedValueOnce(contest({ status: 'finishing', end_time: ended }))
      .mockResolvedValue(contest({ status: 'finished', end_time: ended }));
    renderAt('/contests/3');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('navigation', { name: 'Contest' })).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(6000); });
    await act(async () => { jest.advanceTimersByTime(6000); });
    expect(screen.getByText('page Midterm Practice finished')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    const calls = jest.mocked(contestService.getById).mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(jest.mocked(contestService.getById).mock.calls.length).toBe(calls);
    jest.useRealTimers();
  });

  it('keeps asking after the start time while the server still says scheduled', async () => {
    jest.useFakeTimers();
    const started = new Date(Date.now() - 1000).toISOString();
    jest.mocked(contestService.getById)
      .mockResolvedValueOnce(contest({ status: 'scheduled', start_time: started }))
      .mockResolvedValue(contest({ status: 'running', start_time: started }));
    renderAt('/contests/3');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(6000); });
    expect(await screen.findByRole('navigation', { name: 'Contest' })).toBeInTheDocument();
    jest.useRealTimers();
  });
});
