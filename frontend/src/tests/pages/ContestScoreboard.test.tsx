import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContestScoreboard from '../../pages/contest/ContestScoreboard';
import useContestScoreboard from '../../hooks/useContestScoreboard';

jest.mock('../../hooks/useContestScoreboard', () => ({
  __esModule: true,
  ...jest.requireActual('../../hooks/useContestScoreboard'),
  default: jest.fn(),
}));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, username: 'user2', role: 'user' } }) }));
jest.mock('../../context/ThemeContext', () => ({ useTheme: jest.fn(() => ({ theme: 'light' })) }));
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading…</div>);
jest.mock('react-router-dom', () => ({ ...jest.requireActual('react-router-dom'), useParams: () => ({ contestId: '3' }) }));

const START = '2026-11-16T06:00:00Z';
const rows = [
  { username: 'user1', rank: 1, total_score: 160, last_score_improvement_time: '2026-11-16T06:25:00Z', detailed_scores: {
    p1: { score: 100, attempts: 1, best_at: '2026-11-16T06:10:00Z' }, p2: { score: 60, attempts: 2, best_at: '2026-11-16T06:25:00Z' } } },
  { username: 'user3', rank: 1, total_score: 160, last_score_improvement_time: '2026-11-16T06:25:00Z', detailed_scores: {
    p1: { score: 60, attempts: 1, best_at: '2026-11-16T06:25:00Z' }, p2: { score: 100, attempts: 1, best_at: '2026-11-16T06:20:00Z' } } },
  { username: 'user2', rank: 3, total_score: 0, last_score_improvement_time: '2026-11-16T06:01:00Z', detailed_scores: { p1: { score: 0, attempts: 2 } } },
];
const problems = [{ problem_id: 'p1', title: 'Pair ordering' }, { problem_id: 'p2', title: 'Stack min' }];

let observer: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
const mockHook = (over: Record<string, unknown> = {}) => jest.mocked(useContestScoreboard).mockReturnValue({
  contest: { id: 3, title: 'Mid-term practice', status: 'running', start_time: START, end_time: '2026-11-16T09:00:00Z' },
  scoreboard: rows, problems, status: 'running', startTime: START,
  loading: false, error: '', lastUpdate: new Date(Date.now() - 5000), connected: true,
  ...over,
} as never);
const renderPage = () => render(<MemoryRouter><ContestScoreboard /></MemoryRouter>);
const bodyRows = () => within(screen.getByRole('table', { name: 'Scoreboard' })).getAllByRole('row').slice(1);

describe('ContestScoreboard page', () => {
  beforeEach(() => {
    observer = null;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(cb: typeof observer) { observer = cb; }
      observe() { /* noop */ }
      disconnect() { /* noop */ }
    };
  });

  it('header: LIVE while running, "updated Ns ago", live dot only when connected', () => {
    mockHook();
    const { unmount } = renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Scoreboard');
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText(/updated 5s ago/)).toBeInTheDocument();
    expect(screen.getByLabelText('Live updates on')).toBeInTheDocument();
    unmount();
    mockHook({ connected: false });
    renderPage();
    expect(screen.queryByLabelText('Live updates on')).toBeNull();
  });

  it('FINAL when finished', () => {
    mockHook({ status: 'finished', connected: false });
    renderPage();
    expect(screen.getByText('FINAL')).toBeInTheDocument();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('columns: rank, participant link, total with "last" time from start, one letter column per problem', () => {
    mockHook();
    renderPage();
    const table = screen.getByRole('table', { name: 'Scoreboard' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Rank', 'Participant', 'Total', 'A', 'B']);
    expect(within(table).getByRole('link', { name: 'A: Pair ordering' })).toHaveAttribute('href', '/contests/3/problems/p1');
    const [first] = bodyRows();
    expect(within(first).getByRole('link', { name: 'user1' })).toHaveAttribute('href', '/profile/user1');
    expect(within(first).getByText('last 00:25:00')).toBeInTheDocument();
  });

  it('cells: full, partial, zero, untried, tries', () => {
    mockHook();
    renderPage();
    const [first, , viewer] = bodyRows();
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell');
    expect(cells(first)[3]).toHaveAttribute('data-tone', 'full');
    expect(cells(first)[4]).not.toHaveAttribute('data-tone');
    expect(cells(first)[4]).toHaveTextContent(/60\s*2 tries/);
    expect(cells(viewer)[3]).toHaveAttribute('data-tone', 'zero');
    expect(cells(viewer)[4]).toHaveTextContent('—');
  });

  it('ranks come from the server (1, 1, 3)', () => {
    mockHook();
    renderPage();
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['1', '1', '3']);
  });

  it('highlights the viewer and pins "You · #3" when their row is off-screen', () => {
    mockHook();
    renderPage();
    const viewer = bodyRows()[2];
    expect(viewer).toHaveAttribute('data-viewer', 'true');
    expect(screen.queryByRole('region', { name: 'Your rank' })).toBeNull();
    act(() => observer?.([{ isIntersecting: false }]));
    expect(screen.getByRole('region', { name: 'Your rank' })).toHaveTextContent('You · #3');
    act(() => observer?.([{ isIntersecting: true }]));
    expect(screen.queryByRole('region', { name: 'Your rank' })).toBeNull();
  });

  it('old snapshot without best_at → no "last" line', () => {
    mockHook({ status: 'finished', scoreboard: [
      { username: 'user1', rank: 1, total_score: 100, last_score_improvement_time: '2026-11-16T06:25:00Z', detailed_scores: { p1: { score: 100 } } },
    ] });
    renderPage();
    expect(screen.queryByText(/^last /)).toBeNull();
  });
});
