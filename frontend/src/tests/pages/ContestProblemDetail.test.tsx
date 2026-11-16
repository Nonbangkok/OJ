import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProblemDetail from '../../pages/problem/ProblemDetail';
import { ContestContext } from '../../features/contest/ContestContext';
import problemService from '../../services/problemService';
import contestService from '../../services/contestService';
import submissionService from '../../services/submissionService';
import type { Contest } from '../../types';

jest.mock('../../services/problemService');
jest.mock('../../services/contestService');
jest.mock('../../services/submissionService');
jest.mock('../../services/realtimeService', () => ({ subscribeSubmissions: jest.fn(() => () => undefined) }));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ contestId: '3', problemId: 'interval' }),
}));
jest.mock('../../pages/submission/Submissions', () => () => <div>Submissions list</div>);

const contest = (over: Partial<Contest> = {}): Contest => ({
  id: 3, title: 'Mid-term practice', description: null, status: 'running', is_participant: true,
  start_time: new Date(Date.now() - 3_600_000).toISOString(), end_time: new Date(Date.now() + 3_600_000).toISOString(),
  problems: [{ id: 'sum_digits', title: 'Sum of digits' }, { id: 'queue', title: 'Queue rotate' }, { id: 'interval', title: 'Interval merge' }],
  ...over,
} as Contest);

const renderAt = (value: Contest) => render(
  <ContestContext.Provider value={{ contest: value, error: null, reload: jest.fn() }}>
    <MemoryRouter initialEntries={['/contests/3/problems/interval?tab=submit']}><ProblemDetail /></MemoryRouter>
  </ContestContext.Provider>,
);

describe('ProblemDetail inside a contest', () => {
  beforeEach(() => {
    jest.mocked(problemService.getContestProblemDetails).mockResolvedValue({
      id: 'interval', title: 'Interval merge', time_limit_ms: 1000, memory_limit_mb: 256, has_pdf: false, problem_type: 'standard',
    } as never);
    jest.mocked(contestService.getById).mockResolvedValue(contest());
    jest.mocked(problemService.getPdfUrl).mockReturnValue('/pdf');
  });
  afterEach(() => jest.useRealTimers());

  it('header carries the letter and the contest breadcrumb', async () => {
    renderAt(contest());
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/^C\s*Interval merge$/);
    const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(crumbs).getByRole('link', { name: 'Mid-term practice' })).toHaveAttribute('href', '/contests/3');
    expect(within(crumbs).getByText('C')).toBeInTheDocument();
  });

  it('at end_time the Submit tab closes without a server call', async () => {
    jest.useFakeTimers();
    renderAt(contest({ end_time: new Date(Date.now() + 2000).toISOString() }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText(/Your code/i)).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(screen.getByText(/Contest ended — submissions closed\./)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your code/i)).toBeNull();
    expect(submissionService.submit).not.toHaveBeenCalled();
  });

  it('finishing shows the same closed notice', async () => {
    renderAt(contest({ status: 'finishing', end_time: new Date(Date.now() - 1000).toISOString() }));
    expect(await screen.findByText(/Contest ended — submissions closed\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));
    expect(screen.queryByText(/Contest ended/)).toBeNull();
  });
});
