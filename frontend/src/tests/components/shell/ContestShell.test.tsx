import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { problemLetter, useContestShellReload } from '../../../components/shell/ContestShell';
import ContestLayout from '../../../features/contest/ContestLayout';
import contestService from '../../../services/contestService';
import type { Contest } from '../../../types';

jest.mock('../../../services/contestService', () => ({ __esModule: true, default: { getById: jest.fn(), getProblems: jest.fn() } }));
jest.mock('../../../services/realtimeService', () => ({ subscribeSubmissions: () => () => undefined }));
jest.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, username: 'n', role: 'user', hasAvatar: false } }) }));
jest.mock('../../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }) }));
jest.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ passwordChangeEnabled: true }) }));
// Outside ContestShell's cases (§6) the layout uses the AppShell; a stub is enough here.
jest.mock('../../../components/shell/AppShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

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
        [{ path: '/contests/:contestId', element: <ContestLayout />, children: [{ path: '*', element: <p>page</p> }, { index: true, element: <p>page</p> }] }],
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

  it('reloads when a page reports a join', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest({ is_participant: false }));
    const JoinButton = () => {
      const reload = useContestShellReload();
      return <button type="button" onClick={reload}>Join</button>;
    };
    render(
      <RouterProvider router={createMemoryRouter(
        [{ path: '/contests/:contestId', element: <ContestLayout />, children: [{ index: true, element: <JoinButton /> }] }],
        { initialEntries: ['/contests/3'] },
      )} />,
    );
    // Not joined yet: the normal shell, no contest sidebar.
    await screen.findByRole('button', { name: 'Join' });
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    jest.mocked(contestService.getById).mockResolvedValue(contest({ is_participant: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByRole('link', { name: /my submissions/i })).toBeInTheDocument();
  });

  it('shows your points at the bottom of the sidebar', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    renderShell();
    const nav = await screen.findByRole('navigation', { name: 'Contest' });
    await within(nav).findByRole('link', { name: /A\s+Stack min/ });
    expect(screen.getByText('Your points').parentElement).toHaveTextContent(/Your points\s*140/);
  });

  it('keeps the account menu inside the contest', async () => {
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    renderShell();
    expect(await screen.findByRole('button', { name: 'Open user menu' })).toBeInTheDocument();
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
