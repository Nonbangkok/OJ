import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContestRecap from '../../../features/contest/ContestRecap';
import contestService from '../../../services/contestService';
import { useAuth } from '../../../context/AuthContext';
import type { Contest } from '../../../types';

jest.mock('../../../services/contestService');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const finished = (over: Partial<Contest> = {}): Contest => ({
  id: 18, title: 'Weekly round #18', description: null, status: 'finished', is_participant: true,
  start_time: '2026-11-13T12:00:00Z', end_time: '2026-11-13T14:00:00Z', participant_count: '74',
  problems: [
    { id: 'pair_ord', title: 'Pair ordering' }, { id: 'stack_min', title: 'Stack min' }, { id: 'range_min', title: 'Range minimum' },
  ],
  ...over,
} as Contest);

const P = 'Accepted';
const rows = [
  { username: 'ploy', rank: 1, total_score: 300, last_score_improvement_time: null, detailed_scores: {} },
  { username: 'nattapat', rank: 14, total_score: 180, last_score_improvement_time: null, detailed_scores: {
    pair_ord: { score: 100, attempts: 1, statuses: [P, P] },
    stack_min: { score: 80, attempts: 3, statuses: [P, 'Wrong Answer'] },
  } },
  ...Array.from({ length: 72 }, (_, i) => ({ username: `u${i}`, rank: 15 + i, total_score: 0, last_score_improvement_time: null, detailed_scores: {} })),
];

const renderRecap = (contest = finished(), username = 'nattapat') => {
  jest.mocked(useAuth).mockReturnValue({ user: { id: 7, username, role: 'user' } } as ReturnType<typeof useAuth>);
  return render(<MemoryRouter><ContestRecap contest={contest} /></MemoryRouter>);
};

describe('ContestRecap', () => {
  beforeEach(() => {
    jest.mocked(contestService.getScoreboard).mockResolvedValue({ scoreboard: rows, problems: [], status: 'finished' } as never);
  });

  it('participant: final rank, points and solved', async () => {
    renderRecap();
    const result = await screen.findByRole('list', { name: 'Your result' });
    const items = within(result).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Your final rank\s*#14\s*of 74/);
    expect(items[1]).toHaveTextContent(/Points\s*180\s*\/ 300/);
    expect(items[2]).toHaveTextContent(/Solved\s*1\s*of 3/);
  });

  it('per-problem rows: letter, title linking to the practice problem, strip, score, tries', async () => {
    renderRecap();
    await screen.findByRole('list', { name: 'Your result' });
    const table = screen.getByRole('table', { name: 'Problems' });
    const [, a, b, c] = within(table).getAllByRole('row');
    expect(within(a).getByText('A')).toBeInTheDocument();
    expect(within(a).getByRole('link', { name: 'Pair ordering' })).toHaveAttribute('href', '/problems/pair_ord');
    expect(within(a).getByRole('img', { name: '2 of 2 test cases passed' })).toBeInTheDocument();
    expect(within(b).getByText('80')).toBeInTheDocument();
    expect(within(b).getByText('3')).toBeInTheDocument();
    expect(within(c).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('non-participant: table and Scoreboard button, no rank block', async () => {
    renderRecap(finished({ is_participant: false }), 'guestish');
    expect(await screen.findByRole('table', { name: 'Problems' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your result' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Scoreboard' })).toHaveAttribute('href', '/contests/18/scoreboard');
    expect(screen.queryByRole('columnheader', { name: 'Your best' })).toBeNull();
  });

  it('old snapshot without attempts/statuses → "—" in Tries and no strip', async () => {
    jest.mocked(contestService.getScoreboard).mockResolvedValue({ scoreboard: [
      { username: 'nattapat', rank: 1, total_score: 100, last_score_improvement_time: null, detailed_scores: { pair_ord: { score: 100 }, stack_min: 0 } },
    ], problems: [], status: 'finished' } as never);
    renderRecap();
    await screen.findByRole('list', { name: 'Your result' });
    const table = screen.getByRole('table', { name: 'Problems' });
    const [, a] = within(table).getAllByRole('row');
    expect(within(a).getByText('100')).toBeInTheDocument();
    expect(within(a).queryByRole('img')).toBeNull();
    expect(within(a).getAllByText('—')).toHaveLength(2);
  });

  it('FINAL tag and Scoreboard link', async () => {
    renderRecap();
    expect(screen.getByText('FINAL')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scoreboard' })).toHaveAttribute('href', '/contests/18/scoreboard');
    await screen.findByRole('list', { name: 'Your result' });
  });
});
