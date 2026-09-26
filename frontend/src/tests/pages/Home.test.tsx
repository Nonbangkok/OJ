import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Home from '../../pages/home/Home';
import contestService from '../../services/contestService';
import problemService from '../../services/problemService';
import userService from '../../services/userService';

jest.mock('../../services/contestService');
jest.mock('../../services/problemService');
jest.mock('../../services/userService');

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

const baseProblem = {
  id: 'two-sum',
  title: 'Two Sum',
  author: null,
  difficulty: 800,
};

const renderHome = () =>
  render(
    <BrowserRouter>
      <Home />
    </BrowserRouter>
  );

describe('Home Page (logged in)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = mockUser;
    jest.mocked(userService.getProfile).mockResolvedValue(mockProfile as never);
    jest.mocked(problemService.getAllWithStats).mockResolvedValue([] as never);
    jest.mocked(contestService.getAll).mockResolvedValue([] as never);
  });

  it('renders the hero with the username and progression tier', async () => {
    renderHome();

    expect(screen.getByText('Welcome back, testuser')).toBeInTheDocument();
    expect(screen.getByText('Ready for another challenge?')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Specialist · Level 12')).toBeInTheDocument();
    });
  });

  it('renders the compact progress summary strip, not stat cards', async () => {
    renderHome();

    await waitFor(() => {
      expect(screen.getByText('12 solved')).toBeInTheDocument();
    });
    expect(screen.getByText('7 day streak')).toBeInTheDocument();
    expect(screen.getByText('Level 12 · 2,840 XP')).toBeInTheDocument();
    // The old three-card labels are gone.
    expect(screen.queryByText('Problems Solved')).not.toBeInTheDocument();
    expect(screen.queryByText('Current Streak')).not.toBeInTheDocument();
    expect(screen.queryByText('Experience')).not.toBeInTheDocument();
  });

  it('shows the most recently attempted-but-unsolved problem in Continue where you left off', async () => {
    jest.mocked(problemService.getAllWithStats).mockResolvedValue([
      { ...baseProblem, best_score: 100, submission_count: '3', latest_submission_at: '2026-09-01T00:00:00Z' },
      {
        ...baseProblem,
        id: 'boring-factorials',
        title: 'Boring Factorials',
        difficulty: 1200,
        best_score: 40,
        submission_count: '2',
        latest_submission_at: '2026-09-20T10:00:00Z',
      },
      {
        ...baseProblem,
        id: 'ancient-message',
        title: 'Ancient Message',
        difficulty: 2000,
        best_score: 0,
        submission_count: '5',
        latest_submission_at: '2026-09-10T10:00:00Z',
      },
    ] as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Continue where you left off')).toBeInTheDocument();
    });
    expect(screen.getByText('Boring Factorials')).toBeInTheDocument();
    expect(screen.getByText('boring-factorials')).toBeInTheDocument();
    expect(screen.getByText('2 attempts')).toBeInTheDocument();
    expect(screen.getByText(/Last tried/)).toBeInTheDocument();
    expect(screen.getByText('Continue →')).toBeInTheDocument();
    // The hero primary CTA is Continue Solving when a problem is unfinished;
    // Random Problem is a lower-priority ghost action.
    expect(screen.getByRole('button', { name: 'Continue Solving' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Random Problem/ })).toBeInTheDocument();
    // The older unsolved problem is not the featured one.
    expect(screen.queryByText('Ancient Message')).not.toBeInTheDocument();
  });

  it('suggests an unsolved problem under "Try something new" when fully caught up on attempts', async () => {
    jest.mocked(problemService.getAllWithStats).mockResolvedValue([
      { ...baseProblem, best_score: 100, submission_count: '3', latest_submission_at: '2026-09-01T00:00:00Z' },
      { ...baseProblem, id: 'fresh-one', title: 'A Fresh Challenge', best_score: null, submission_count: null, latest_submission_at: null },
    ] as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Try something new')).toBeInTheDocument();
    });
    expect(screen.queryByText('Continue where you left off')).not.toBeInTheDocument();
    expect(screen.getByText('A Fresh Challenge')).toBeInTheDocument();
    expect(screen.getByText('Solve Problem →')).toBeInTheDocument();
    // The hero primary CTA is Browse Problems when nothing is unfinished.
    expect(screen.getByRole('button', { name: 'Browse Problems' })).toBeInTheDocument();
  });

  it('shows a light caught-up line when every problem is already solved', async () => {
    jest.mocked(problemService.getAllWithStats).mockResolvedValue([
      { ...baseProblem, best_score: 100, submission_count: '3', latest_submission_at: '2026-09-01T00:00:00Z' },
    ] as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Try something new')).not.toBeInTheDocument();
  });

  it('renders the running contest with a countdown and open action', async () => {
    const end = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    jest.mocked(contestService.getAll).mockResolvedValue([
      {
        id: 3,
        title: 'Monthly Contest',
        description: null,
        start_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end_time: end,
        status: 'running' as const,
      },
    ] as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Monthly Contest')).toBeInTheDocument();
    });
    expect(screen.getByText(/Ends in 1h/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Contest/ })).toBeInTheDocument();
  });

  it('prefers a running contest over a scheduled one', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([
      {
        id: 4,
        title: 'Future Contest',
        description: null,
        start_time: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'scheduled' as const,
      },
      {
        id: 5,
        title: 'Live Contest',
        description: null,
        start_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        status: 'running' as const,
      },
    ] as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Live Contest')).toBeInTheDocument();
    });
    expect(screen.queryByText('Future Contest')).not.toBeInTheDocument();
  });

  it('shows the nearest scheduled contest when nothing is running', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([
      {
        id: 6,
        title: 'Far Contest',
        description: null,
        start_time: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'scheduled' as const,
      },
      {
        id: 7,
        title: 'Near Contest',
        description: null,
        start_time: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
        status: 'scheduled' as const,
      },
    ] as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Near Contest')).toBeInTheDocument();
    });
    expect(screen.getByText(/Starts in 1d/)).toBeInTheDocument();
    expect(screen.queryByText('Far Contest')).not.toBeInTheDocument();
  });

  it('omits the contest card entirely when no running or scheduled contest exists', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([
      {
        id: 8,
        title: 'Old Contest',
        description: null,
        start_time: '2026-01-01T00:00:00Z',
        end_time: '2026-01-02T00:00:00Z',
        status: 'finished' as const,
      },
    ] as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Welcome back, testuser')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Open Contest/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Old Contest')).not.toBeInTheDocument();
  });

  it('renders the quote card with a shuffle control that changes the quote', async () => {
    renderHome();

    const shuffleButton = await screen.findByRole('button', { name: /another quote/i });
    expect(shuffleButton).toBeInTheDocument();

    const initialText = screen.getByTestId('home-quote').textContent;
    expect(initialText).toBeTruthy();

    jest.useFakeTimers();
    fireEvent.click(shuffleButton);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();

    const nextText = screen.getByTestId('home-quote').textContent;
    expect(nextText).toBeTruthy();
    expect(nextText).not.toBe(initialText);
  });

  it('hides the stat cards when the profile fails to load', async () => {
    jest.mocked(userService.getProfile).mockRejectedValue(new Error('fail') as never);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Welcome back, testuser')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('12 solved')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Browse Problems' })).toBeInTheDocument();
    expect(screen.queryByText('Start Solving')).not.toBeInTheDocument();
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
    expect(userService.getProfile).not.toHaveBeenCalled();
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
