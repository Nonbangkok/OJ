import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ContestDetail from '../../pages/contest/ContestDetail';
import { ContestContext } from '../../features/contest/ContestContext';
import contestService from '../../services/contestService';
import type { Contest } from '../../types';

jest.mock('../../services/contestService');

const HOUR = 3_600_000;
const contest = (over: Partial<Contest> = {}): Contest => ({
  id: 19, title: 'Weekly round #19', description: null, status: 'scheduled', is_participant: false,
  start_time: new Date(Date.now() + 4 * 24 * HOUR).toISOString(),
  end_time: new Date(Date.now() + 4 * 24 * HOUR + 2 * HOUR).toISOString(),
  participant_count: '12', problem_count: 6, problems: [],
  ...over,
} as Contest);

const roster = ['nattapat', 'ploy.s', 'tonkla'].map((username, i) => ({ user_id: i + 1, username, total_score: 0, detailed_scores: {} }));

const renderAt = (value: Contest, reload = jest.fn()) => {
  const utils = render(
    <ContestContext.Provider value={{ contest: value, error: null, reload }}>
      <MemoryRouter initialEntries={[`/contests/${value.id}`]}>
        <Routes>
          <Route path="/contests/:contestId" element={<ContestDetail />} />
          <Route path="/contests/:contestId/problems" element={<p>problem table</p>} />
          <Route path="/contests/:contestId/problems/:problemId" element={<p>problem page</p>} />
        </Routes>
      </MemoryRouter>
    </ContestContext.Provider>,
  );
  return { ...utils, reload };
};

describe('ContestDetail: lobby (scheduled)', () => {
  beforeEach(() => {
    jest.mocked(contestService.getScoreboard).mockResolvedValue({ scoreboard: roster, problems: [] } as never);
    jest.mocked(contestService.join).mockResolvedValue({ message: 'ok' } as never);
  });
  afterEach(() => jest.useRealTimers());

  it('shows the SCHEDULED tag, a mono countdown and the rule facts', async () => {
    renderAt(contest());
    expect(screen.getByRole('heading', { name: /Weekly round #19/, level: 1 })).toBeInTheDocument();
    expect(screen.getByText('SCHEDULED')).toBeInTheDocument();
    expect(screen.getByText('Starts in')).toBeInTheDocument();
    expect(screen.getByTestId('lobby-countdown')).toHaveTextContent(/^\dd \d\d:\d\d$/);
    const facts = screen.getByRole('list', { name: 'Contest rules' });
    for (const label of ['Window', 'Duration', 'Problems', 'Scoring']) expect(within(facts).getByText(label)).toBeInTheDocument();
    expect(within(facts).getByText('2 h')).toBeInTheDocument();
    expect(within(facts).getByText('6')).toBeInTheDocument();
    expect(within(facts).getByText('IOI · sum of best scores · ties by earliest last improvement')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Registered · 3' })).toBeInTheDocument();
    expect(screen.getByText('ploy.s')).toBeInTheDocument();
  });

  it('Join → Registered (disabled) and reload()', async () => {
    const { reload, rerender } = renderAt(contest());
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await act(async () => { await Promise.resolve(); });
    expect(contestService.join).toHaveBeenCalledWith(19);
    expect(reload).toHaveBeenCalled();
    rerender(
      <ContestContext.Provider value={{ contest: contest({ is_participant: true }), error: null, reload }}>
        <MemoryRouter initialEntries={['/contests/19']}><Routes><Route path="/contests/:contestId" element={<ContestDetail />} /></Routes></MemoryRouter>
      </ContestContext.Provider>,
    );
    expect(screen.getByRole('button', { name: /Registered/ })).toBeDisabled();
  });

  it('at zero calls reload once and, if still scheduled, shows "Starting…" without looping', async () => {
    jest.useFakeTimers();
    const { reload } = renderAt(contest({ start_time: new Date(Date.now() + 2000).toISOString() }));
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('lobby-countdown')).toHaveTextContent('Starting…');
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('ContestDetail: running, not joined', () => {
  const running = () => contest({
    status: 'running', problem_count: 5, participant_count: '86',
    start_time: new Date(Date.now() - HOUR).toISOString(), end_time: new Date(Date.now() + HOUR).toISOString(),
  });
  beforeEach(() => {
    jest.mocked(contestService.join).mockResolvedValue({ message: 'ok' } as never);
    jest.mocked(contestService.getProblems).mockResolvedValue([{ id: 'sum_digits', title: 'Sum of digits' }] as never);
  });

  it('shows letters A–E from problem_count with titles hidden', () => {
    renderAt(running());
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Problems' });
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(within(table).getAllByText('Hidden until you join')).toHaveLength(5);
  });

  it('Join contest → join() then lands on problem A', async () => {
    const { reload } = renderAt(running());
    fireEvent.click(screen.getByRole('button', { name: 'Join contest' }));
    expect(await screen.findByText('problem page')).toBeInTheDocument();
    expect(contestService.join).toHaveBeenCalledWith(19);
    expect(reload).toHaveBeenCalled();
  });

  it('join failure shows the server message', async () => {
    jest.mocked(contestService.join).mockRejectedValue({ response: { data: { message: 'Submissions are locked for your account' } } });
    renderAt(running());
    fireEvent.click(screen.getByRole('button', { name: 'Join contest' }));
    expect(await screen.findByText('Submissions are locked for your account')).toBeInTheDocument();
  });
});

describe('ContestDetail: participant while running', () => {
  it('goes straight to the problem table', async () => {
    renderAt(contest({ status: 'running', is_participant: true, start_time: new Date(Date.now() - HOUR).toISOString() }));
    expect(await screen.findByText('problem table')).toBeInTheDocument();
  });
});
