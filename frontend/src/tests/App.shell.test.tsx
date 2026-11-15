import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { appRoutes } from '../App';
import { AuthProvider } from '../context/AuthContext';
import { SettingsProvider } from '../context/SettingsContext';
import authService from '../services/authService';
import contestService from '../services/contestService';

jest.mock('../services/authService');
jest.mock('../services/contestService', () => ({ __esModule: true, default: { getAll: jest.fn(), getById: jest.fn(), getProblems: jest.fn() } }));
jest.mock('../services/realtimeService', () => ({ subscribeSubmissions: () => () => undefined, subscribeScoreboard: () => () => undefined }));
jest.mock('../routing/problemListLoaders', () => ({
  publicProblemsLoader: () => null,
  adminProblemsLoader: () => null,
  revalidateProblemListOnPathChange: () => false,
}));
// Pages are stubbed: this test is about which shell wraps them.
jest.mock('../pages/problem/Problems', () => ({ __esModule: true, default: () => <p>Problems page</p> }));
jest.mock('../pages/contest/ContestScoreboard', () => ({ __esModule: true, default: () => <p>Contest scoreboard page</p> }));
jest.mock('../features/admin/problems/ProblemManagement', () => ({ __esModule: true, default: () => <p>Manage problems page</p> }));
jest.mock('../features/admin/authoring/ProblemAuthoring', () => ({ __esModule: true, default: () => <p>Authoring page</p> }));
jest.mock('../pages/auth/Login', () => ({ __esModule: true, default: () => <p>Login page</p> }));

const asRole = (role: 'user' | 'staff' | null) => {
  if (role) {
    (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValue({ isAuthenticated: true, user: { id: 1, username: 'n', role, hasAvatar: false } });
  } else {
    (jest.mocked(authService.checkLogin) as jest.Mock).mockRejectedValue(new Error('guest'));
  }
  (jest.mocked(authService.getSiteConfig) as jest.Mock).mockResolvedValue({ siteAccessMode: 'public', registrationEnabled: true, passwordChangeEnabled: true });
};

const renderAt = (path: string) => render(
  <AuthProvider>
    <SettingsProvider>
      <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
    </SettingsProvider>
  </AuthProvider>,
);

describe('route → shell', () => {
  beforeEach(() => {
    // jest.config resets mocks before each test, so implementations live here.
    jest.mocked(contestService.getAll).mockResolvedValue([]);
    jest.mocked(contestService.getById).mockResolvedValue({ id: 3, title: 'Midterm', status: 'running', is_participant: true, description: null, start_time: new Date().toISOString(), end_time: new Date(Date.now() + 3_600_000).toISOString() });
    jest.mocked(contestService.getProblems).mockResolvedValue([]);
    localStorage.clear();
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn() })) as unknown as typeof window.matchMedia;
  });

  it('wraps practice pages in the app shell', async () => {
    asRole('user');
    renderAt('/problems');
    expect(await screen.findByText('Problems page')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('gives login no sidebar', async () => {
    asRole(null);
    renderAt('/login');
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('uses the contest sidebar inside a contest', async () => {
    asRole('user');
    renderAt('/contests/3/scoreboard');
    expect(await screen.findByText('Contest scoreboard page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /leave contest view/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('keeps Manage pages in the same sidebar', async () => {
    asRole('staff');
    renderAt('/admin/problems');
    expect(await screen.findByText('Manage problems page')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Manage');
    expect(screen.getAllByRole('link', { name: /problems/i }).find((a) => a.getAttribute('href') === '/admin/problems')).toHaveAttribute('aria-current', 'page');
  });

  it('shows no sidebar in the statement editor', async () => {
    asRole('staff');
    renderAt('/admin/authoring/d1/editor');
    expect(await screen.findByText('Authoring page')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('renders the 404 inside the app shell', async () => {
    asRole('user');
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});
