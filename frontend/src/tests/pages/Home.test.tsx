import { render, screen, fireEvent, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Home from '../../pages/home/Home';
import contestService from '../../services/contestService';
import homeService from '../../services/homeService';
import type { HomeSummary } from '../../types';

jest.mock('../../services/contestService');
jest.mock('../../services/homeService');

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
  });

  it('shows the continue block with strip and verdict', async () => {
    renderHome();
    expect(screen.getByRole('heading', { name: 'Continue where you left off' })).toBeInTheDocument();
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
    expect(screen.queryByRole('heading', { name: 'Contest' })).toBeNull();
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

  it('renders a simple welcome with Browse Problems and login CTA, no dashboard content', () => {
    renderHome();

    expect(screen.getByText('Welcome to Grader')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse Problems' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();

    // Dashboard content is for logged-in users only.
    expect(screen.queryByText(/day streak/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /another quote/i })).not.toBeInTheDocument();
    expect(homeService.getHome).not.toHaveBeenCalled();
  });

  it('PRIVATE mode shows the private landing without a Browse Problems CTA', () => {
    mockIsPrivateMode = true;
    renderHome();

    expect(screen.getByText(/This Grader is private/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse Problems' })).not.toBeInTheDocument();
    // Registration on -> Create account offered.
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('PRIVATE mode hides Create account when registration is disabled', () => {
    mockIsPrivateMode = true;
    mockRegistrationEnabled = false;
    renderHome();

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
  });
});
