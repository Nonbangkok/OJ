import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ContestProblems from '../../pages/contest/ContestProblems';
import { ContestContext } from '../../features/contest/ContestContext';
import contestService from '../../services/contestService';
import type { Contest } from '../../types';

jest.mock('../../services/contestService');

const HOUR = 3_600_000;
const contest = (over: Partial<Contest> = {}): Contest => ({
  id: 3, title: 'Mid-term practice', description: null, status: 'running', is_participant: true,
  start_time: new Date(Date.now() - HOUR).toISOString(), end_time: new Date(Date.now() + HOUR).toISOString(),
  ...over,
} as Contest);
const results = (s: string) => [...s].map((c) => ({ status: c === 'P' ? 'Accepted' : c === 'F' ? 'Wrong Answer' : 'Skipped' }));
const problems = [
  { id: 'sum_digits', title: 'Sum of digits', best_score: 100, submission_count: '1', best_submission_results: results('PPPP') },
  { id: 'interval', title: 'Interval merge', best_score: 60, submission_count: '4', best_submission_results: results('PPFN') },
  { id: 'matrix', title: 'Matrix exponent', best_score: null, submission_count: '0', best_submission_results: null },
];

const renderAt = (value: Contest) => render(
  <ContestContext.Provider value={{ contest: value, error: null, reload: jest.fn() }}>
    <MemoryRouter initialEntries={['/contests/3/problems']}>
      <Routes>
        <Route path="/contests/:contestId/problems" element={<ContestProblems />} />
        <Route path="/contests/:contestId" element={<p>contest home</p>} />
      </Routes>
    </MemoryRouter>
  </ContestContext.Provider>,
);

describe('ContestProblems', () => {
  beforeEach(() => jest.mocked(contestService.getProblems).mockResolvedValue(problems as never));

  it('rows in server order with letters, title link, best strip, score and tries', async () => {
    renderAt(contest());
    const table = await screen.findByRole('table', { name: 'Problems' });
    const [, a, b, c] = within(table).getAllByRole('row');
    expect(within(a).getByText('A')).toBeInTheDocument();
    expect(within(a).getByRole('link', { name: 'Sum of digits' })).toHaveAttribute('href', '/contests/3/problems/sum_digits');
    expect(within(a).getByRole('img', { name: '4 of 4 test cases passed' })).toBeInTheDocument();
    expect(within(b).getByText('B')).toBeInTheDocument();
    expect(within(b).getByText('60')).toBeInTheDocument();
    expect(within(b).getByText('4')).toBeInTheDocument();
    expect(within(c).getByText('C')).toBeInTheDocument();
    expect(within(c).getAllByText('—')).toHaveLength(3);
  });

  it('header meta shows the contest and points of max', async () => {
    renderAt(contest());
    expect(await screen.findByText('Mid-term practice · 160 / 300 points')).toBeInTheDocument();
  });

  it('finishing says final submissions are being judged', async () => {
    renderAt(contest({ status: 'finishing', end_time: new Date(Date.now() - 1000).toISOString() }));
    expect(await screen.findByRole('status')).toHaveTextContent('Judging final submissions…');
  });

  it('sends a non-participant to the join gate', async () => {
    renderAt(contest({ is_participant: false }));
    expect(await screen.findByText('contest home')).toBeInTheDocument();
  });
});
