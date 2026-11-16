import { render, screen, fireEvent, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Home from '../../pages/home/Home';
import contestService from '../../services/contestService';
import homeService from '../../services/homeService';
import type { HomeSummary } from '../../types';

jest.mock('../../services/contestService');
jest.mock('../../services/homeService');
jest.mock('../../services/problemService');
jest.mock('../../services/submissionService');
jest.mock('../../services/scoreboardService');
import problemService from '../../services/problemService';
import submissionService from '../../services/submissionService';
import scoreboardService from '../../services/scoreboardService';

const mockUser = { id: 1, username: 'testuser', role: 'user' as const, hasAvatar: false };

// AuthContext is mocked with a mutable user so each describe block can flip it.
// (The `mock` prefix is required for jest to allow out-of-scope access.)
let mockAuthUser: typeof mockUser | null = mockUser;
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuthUser, isLoading: false, login: jest.fn(), logout: jest.fn() }),
}));

// Mutable so private/public-mode landing tests can flip it per case.
let mockIsPrivateMode = false;
let mockRegistrationEnabled = true;
jest.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({
    registrationEnabled: mockRegistrationEnabled,
    accessMode: mockIsPrivateMode ? 'private' : 'public',
    isPrivateMode: mockIsPrivateMode,
    isLoading: false,
    refreshSettings: jest.fn(),
  }),
}));

const mockProfile = {
  problemsSolved: 12,
  currentStreak: 7,
  progression: {
    totalXp: 2840,
    level: 12,
    tier: 'Specialist',
    levelProgress: { current: 240, required: 400, remaining: 160, percentage: 60 },
    globalRank: 5,
  },
};


const renderHome = () =>
  render(
    <BrowserRouter>
      <Home />
    </BrowserRouter>
  );

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const accepted = { status: 'Accepted' };
const summary = (over: Partial<HomeSummary> = {}): HomeSummary => ({
  progression: mockProfile.progression,
  currentStreak: 5,
  solvedToday: false,
  week: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']
    .map((day, i) => ({ day, solved: [1, 4, 0, 2, 6, 1, 0][i] })),
  continue: {
    id: 'hp_vec04_erase', title: 'vector::erase', difficulty: 1200, xp: 60,
    bestScore: 60, attempts: 3, lastTriedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    latestStatus: 'Wrong Answer',
    caseStatuses: [...Array(6).fill('Accepted'), 'Wrong Answer', 'Skipped', 'Skipped', 'Skipped'],
  },
  startWith: [],
  collections: [{ id: 2, name: 'pair', solved: 9, total: 10, next: { id: 'pair_ord', title: 'pair ordering', difficulty: 900, xp: 30 } }],
  levelUp: null,
  ...over,
});

describe('Home Page (logged in)', () => {
  beforeEach(() => {
    mockAuthUser = mockUser;
    mockNavigate.mockReset();
    jest.mocked(homeService.getHome).mockResolvedValue(summary());
    jest.mocked(contestService.getAll).mockResolvedValue([]);
    jest.mocked(submissionService.getAll).mockResolvedValue([]);
    jest.mocked(scoreboardService.getRanking).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50, window: 'week', viewer: null });
  });

  const sub = (id: number, over: Record<string, unknown> = {}) => ({
    id, username: 'testuser', problem_id: `p${id}`, problem_title: `Problem ${id}`, overall_status: 'Accepted', score: 100,
    language: 'cpp', submitted_at: new Date(Date.now() - id * 60e3).toISOString(), case_statuses: ['Accepted', 'Accepted'], ...over,
  });
  const leader = (rank: number, username: string, xp: number) => ({ rank, username, hasAvatar: false, xp, solved: 3, level: 4, tier: 'Novice' });

  it('lists your five latest submissions with verdicts, each opening its page', async () => {
    jest.mocked(submissionService.getAll).mockResolvedValue([
      sub(101, { overall_status: 'Wrong Answer', score: 20, case_statuses: ['Accepted', 'Wrong Answer', 'Skipped', 'Skipped', 'Skipped'] }),
      sub(102), sub(103), sub(104), sub(105), sub(106), sub(107),
    ] as never);
    renderHome();
    const recent = await screen.findByRole('region', { name: 'Recent submissions' });
    expect(submissionService.getAll).toHaveBeenCalledWith({ filter: 'mine' });
    const rows = await within(recent).findAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByRole('link', { name: /Problem 101/ })).toHaveAttribute('href', '/submissions/101');
    expect(rows[0]).toHaveTextContent('WRONG 1/5');
    expect(within(recent).getByRole('link', { name: 'All submissions' })).toHaveAttribute('href', '/submissions');
  });

  it('says so when you have not submitted yet', async () => {
    renderHome();
    const recent = await screen.findByRole('region', { name: 'Recent submissions' });
    expect(await within(recent).findByText('No submissions yet — your verdicts will show up here.')).toBeInTheDocument();
  });

  it('shows this week\'s leaders and where you stand', async () => {
    jest.mocked(scoreboardService.getRanking).mockResolvedValue({
      rows: [leader(1, 'ploy.s', 320), leader(2, 'thanawat99', 260), leader(3, 'krit.p', 180), leader(4, 'mintra_j', 120), leader(5, 'nan_k', 90), leader(6, 'june.t', 80)],
      total: 30, page: 1, pageSize: 50, window: 'week', viewer: leader(12, 'testuser', 40),
    });
    renderHome();
    const top = await screen.findByRole('region', { name: 'Top this week' });
    expect(scoreboardService.getRanking).toHaveBeenCalledWith('week', 1);
    const rows = within(top).getAllByRole('listitem');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent(/1\s*ploy\.s\s*\+320 XP/);
    expect(rows[5]).toHaveTextContent(/12\s*You\s*\+40 XP/);
    expect(within(top).getByRole('link', { name: 'Ranking' })).toHaveAttribute('href', '/scoreboard?window=week');
  });

  it('lists running and upcoming contests, running first, finished left out', async () => {
    const t = (hours: number) => new Date(Date.now() + hours * 3600e3).toISOString();
    jest.mocked(contestService.getAll).mockResolvedValue([
      { id: 3, title: 'Monthly #12', status: 'scheduled', start_time: t(48), end_time: t(51) },
      { id: 1, title: 'Old Cup', status: 'finished', start_time: t(-80), end_time: t(-77) },
      { id: 2, title: 'Sprint #7', status: 'running', start_time: t(-1), end_time: t(70) },
      { id: 4, title: 'Camp', status: 'scheduled', start_time: t(200), end_time: t(205) },
      { id: 5, title: 'Later', status: 'scheduled', start_time: t(300), end_time: t(305) },
    ] as never);
    renderHome();
    const panel = await screen.findByRole('region', { name: 'Contests' });
    const links = within(panel).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/contests/'));
    expect(links.map((a) => a.textContent)).toEqual(['Sprint #7', 'Monthly #12', 'Camp']);
    expect(within(panel).queryByText('Old Cup')).toBeNull();
    expect(within(panel).getByRole('link', { name: 'All contests' })).toHaveAttribute('href', '/contests');
  });

  it('greets a returning student by name', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back, testuser' })).toBeInTheDocument();
    expect(screen.getByText('Continue where you left off')).toBeInTheDocument();
  });

  it('welcomes a brand-new student and points at a first problem', async () => {
    jest.mocked(homeService.getHome).mockResolvedValue(summary({
      continue: null, currentStreak: 0,
      progression: { ...mockProfile.progression, totalXp: 0, level: 1 },
      week: summary().week.map((d) => ({ ...d, solved: 0 })),
      startWith: [{ id: 'easy', title: 'Easy one', difficulty: 800, xp: 20 }],
    }));
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, testuser' })).toBeInTheDocument();
    expect(screen.getByText('Pick a first problem to get started')).toBeInTheDocument();
  });

  it('shows the continue block with strip and verdict', async () => {
    renderHome();
    const block = await screen.findByRole('region', { name: 'Continue' });
    expect(within(block).getByRole('link', { name: 'vector::erase' })).toHaveAttribute('href', '/problems/hp_vec04_erase');
    expect(within(block).getByText('hp_vec04_erase')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '6 of 10 test cases passed' })).toBeInTheDocument();
    expect(screen.getByText('WRONG 6/10')).toBeInTheDocument();
    expect(screen.getByText(/3 attempts/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /XP to Lv\.13/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^pair\s*9\/10$/ })).toHaveAttribute('href', '/problems?collection=2');
  });

  it('falls back to Start with when nothing is in progress', async () => {
    jest.mocked(homeService.getHome).mockResolvedValue(summary({
      continue: null,
      startWith: [{ id: 'easy', title: 'Easy one', difficulty: 800, xp: 20 }, { id: 'b', title: 'Bee', difficulty: 900, xp: 24 }],
    }));
    renderHome();
    const start = await screen.findByRole('region', { name: 'Start with' });
    expect(within(start).getByRole('link', { name: /Easy one/ })).toHaveAttribute('href', '/problems/easy');
  });

  it('Enter opens the continue problem but not from an input', async () => {
    renderHome();
    await screen.findByRole('region', { name: 'Continue' });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/problems/hp_vec04_erase');
    input.remove();
  });

  it('marks today in the week strip and totals the week', async () => {
    renderHome();
    expect(await screen.findByText('14 solved this week · 5-day run')).toBeInTheDocument();
    expect(screen.getAllByTestId('week-day')[6]).toHaveAttribute('data-today', 'true');
  });

  it('renders the running contest, and no contest panel when there is none', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([
      { id: 9, title: 'Weekly #42', status: 'running', start_time: new Date(Date.now() - 3600e3).toISOString(), end_time: new Date(Date.now() + 3600e3).toISOString() } as never,
    ]);
    const { unmount } = renderHome();
    expect(await screen.findByRole('link', { name: 'Weekly #42' })).toHaveAttribute('href', '/contests/9');
    expect(screen.getByText(/^ENDS IN/)).toBeInTheDocument();
    unmount();
    jest.mocked(contestService.getAll).mockResolvedValue([]);
    renderHome();
    await screen.findByRole('region', { name: 'Continue' });
    expect(screen.queryByRole('region', { name: 'Contests' })).toBeNull();
  });

  it('shows an inline error with retry when the summary fails', async () => {
    jest.mocked(homeService.getHome).mockRejectedValueOnce(new Error('boom'));
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your progress.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Continue' })).toBeInTheDocument();
  });
});

describe('Home Page (logged out)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = null;
    mockIsPrivateMode = false;
    mockRegistrationEnabled = true;
  });

  it('public mode shows the guest home, not the dashboard', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([]);
    jest.mocked(problemService.getProblemsPage).mockResolvedValue({ problems: [], nextCursor: null, hasMore: false } as never);
    renderHome();

    expect(screen.getByRole('heading', { level: 1, name: 'Grader' })).toBeInTheDocument();
    expect(screen.getByText(/Browse freely; log in to submit/)).toBeInTheDocument();
    expect(screen.queryByText('Continue where you left off')).toBeNull();
    expect(homeService.getHome).not.toHaveBeenCalled();
  });

  it('PRIVATE mode shows the private landing with Log in and Create account', () => {
    mockIsPrivateMode = true;
    renderHome();

    expect(screen.getByRole('heading', { name: 'This Grader is private' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
  });

  it('PRIVATE mode hides Create account when registration is disabled', () => {
    mockIsPrivateMode = true;
    mockRegistrationEnabled = false;
    renderHome();

    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull();
  });
});
