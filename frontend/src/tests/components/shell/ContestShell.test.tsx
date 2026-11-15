import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import ContestShell, { problemLetter, useContestShellReload } from '../../../components/shell/ContestShell';
import contestService from '../../../services/contestService';
import type { Contest } from '../../../types';

jest.mock('../../../services/contestService', () => ({ __esModule: true, default: { getById: jest.fn(), getProblems: jest.fn() } }));
jest.mock('../../../services/realtimeService', () => ({ subscribeSubmissions: () => () => undefined }));
jest.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, username: 'n', role: 'user', hasAvatar: false } }) }));
jest.mock('../../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }) }));
jest.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ passwordChangeEnabled: true }) }));

const setMobile = (mobile: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes('max-width'), media: query,
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
};

const contest = (over: Partial<Contest> = {}): Contest => ({
  id: 3, title: 'Midterm Practice', description: null, status: 'running', is_participant: true,
  start_time: new Date(Date.now() - 3_600_000).toISOString(),
  end_time: new Date(Date.now() + 90 * 60_000).toISOString(),
  ...over,
});

const problems = [
  { id: 'stack', title: 'Stack min', best_score: 100, submission_count: '2' },
  { id: 'queue', title: 'Queue rotate', best_score: 40, submission_count: '3' },
  { id: 'list', title: 'List splice', best_score: null, submission_count: '0' },
];

const renderShell = (path = '/contests/3/scoreboard') =>
  render(
    <RouterProvider
      router={createMemoryRouter(
        [{ path: '/contests/:contestId', element: <ContestShell />, children: [{ path: '*', element: <p>page</p> }, { index: true, element: <p>page</p> }] }],
        { initialEntries: [path] },
      )}
    />,
  );

describe('problemLetter', () => {
  it.each([[0, 'A'], [25, 'Z'], [26, 'AA'], [27, 'AB']])('%i → %s', (i, letter) => expect(problemLetter(i)).toBe(letter));
});

describe('ContestShell', () => {
  beforeEach(() => {
    setMobile(false);
    jest.mocked(contestService.getProblems).mockResolvedValue(problems as never);
  });

  it('shows the contest sidebar for a running contest', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    renderShell();
    const nav = await screen.findByRole('navigation', { name: 'Contest' });
    expect(within(nav).getByRole('link', { name: /leave contest view/i })).toHaveAttribute('href', '/contests');
    expect(await screen.findByText('Midterm Practice')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/01:2\d:\d\d|01:30:00/)).toBeInTheDocument();
    const a = await within(nav).findByRole('link', { name: /A\s+Stack min/ });
    expect(a).toHaveAttribute('href', '/contests/3/problems/stack');
    expect(within(nav).getByRole('link', { name: /B\s+Queue rotate/ })).toHaveTextContent('40');
    expect(within(nav).getByRole('link', { name: /C\s+List splice/ })).not.toHaveTextContent(/\d{2,3}$/);
    expect(within(nav).getByRole('link', { name: /my submissions/i })).toHaveAttribute('href', '/contests/3/submissions');
    expect(within(nav).getByRole('link', { name: /scoreboard/i })).toHaveAttribute('href', '/contests/3/scoreboard');
  });

  it('hides My submissions from non-participants', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest({ is_participant: false }));
    renderShell();
    const nav = await screen.findByRole('navigation', { name: 'Contest' });
    await screen.findByText('Midterm Practice');
    expect(within(nav).queryByRole('link', { name: /my submissions/i })).toBeNull();
  });

  it('always offers a Problems link while the contest is not finished', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest({ status: 'scheduled', start_time: new Date(Date.now() + 60_000).toISOString() }));
    jest.mocked(contestService.getProblems).mockResolvedValue([] as never);
    renderShell();
    const nav = await screen.findByRole('navigation', { name: 'Contest' });
    await screen.findByText('Midterm Practice');
    expect(within(nav).getByRole('link', { name: /^problems$/i })).toHaveAttribute('href', '/contests/3/problems');
  });

  it('reloads the contest when its clock reaches zero', async () => {
    jest.useFakeTimers();
    jest.mocked(contestService.getById).mockResolvedValue(contest({ status: 'scheduled', start_time: new Date(Date.now() + 2000).toISOString() }));
    renderShell();
    await act(async () => { await Promise.resolve(); });
    const before = jest.mocked(contestService.getById).mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(jest.mocked(contestService.getById).mock.calls.length).toBeGreaterThan(before);
    jest.useRealTimers();
  });

  it('reloads when a page reports a join', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest({ is_participant: false }));
    const JoinButton = () => {
      const reload = useContestShellReload();
      return <button type="button" onClick={reload}>Join</button>;
    };
    render(
      <RouterProvider router={createMemoryRouter(
        [{ path: '/contests/:contestId', element: <ContestShell />, children: [{ index: true, element: <JoinButton /> }] }],
        { initialEntries: ['/contests/3'] },
      )} />,
    );
    await screen.findByText('Midterm Practice');
    jest.mocked(contestService.getById).mockResolvedValue(contest({ is_participant: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByRole('link', { name: /my submissions/i })).toBeInTheDocument();
  });

  it('keeps the account menu inside the contest', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    renderShell();
    expect(await screen.findByRole('button', { name: 'Open user menu' })).toBeInTheDocument();
  });

  it('hides the problem list once the contest is finished', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest({ status: 'finished', end_time: new Date(Date.now() - 60_000).toISOString() }));
    renderShell();
    const nav = await screen.findByRole('navigation', { name: 'Contest' });
    expect(await screen.findByText('Ended')).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /stack min/i })).toBeNull();
    expect(within(nav).getByRole('link', { name: /scoreboard/i })).toBeInTheDocument();
  });

  it('uses a contest tab bar on phones', async () => {
    setMobile(true);
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    renderShell();
    await screen.findByText('Midterm Practice');
    const tabs = screen.getByRole('navigation', { name: 'Contest' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /back to contests/i })).toHaveAttribute('href', '/contests');
  });

  it('phone tabs follow participation and contest state', async () => {
    setMobile(true);
    jest.mocked(contestService.getById).mockResolvedValue(contest({ is_participant: false }));
    const { unmount } = renderShell();
    await screen.findByText('Midterm Practice');
    let tabs = screen.getByRole('navigation', { name: 'Contest' });
    expect(within(tabs).queryByRole('link', { name: /mine/i })).toBeNull();
    unmount();
    jest.mocked(contestService.getById).mockResolvedValue(contest({ status: 'finished', end_time: new Date(Date.now() - 1000).toISOString() }));
    renderShell();
    await screen.findByText('Midterm Practice');
    tabs = screen.getByRole('navigation', { name: 'Contest' });
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Scoreboard']);
  });

  it('wraps the page the same way on phones and desktops so crossing the breakpoint does not remount it', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    setMobile(true);
    const { unmount } = renderShell();
    await screen.findByText('Midterm Practice');
    expect(screen.getByText('page').closest('main > .container')).not.toBeNull();
    unmount();
    setMobile(false);
    renderShell();
    await screen.findByText('Midterm Practice');
    expect(screen.getByText('page').closest('main > .container')).not.toBeNull();
  });
});
