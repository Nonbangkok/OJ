import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import ContestEditPage from '../../../features/admin/contests/ContestEditPage';
import adminService from '../../../services/adminService';
import contestService from '../../../services/contestService';

jest.mock('../../../services/adminService');
jest.mock('../../../services/contestService');

const NOW = Date.parse('2026-11-20T03:00:00.000Z');
const contest = (over = {}) => ({
  id: 7, title: 'Weekly 12', description: 'Round twelve', status: 'scheduled',
  start_time: '2026-11-27T12:00:00.000Z', end_time: '2026-11-27T14:00:00.000Z',
  participant_count: '2', problem_count: 3, is_visible: true, ...over,
});
const problems = [{ id: 'P1', title: 'Interval merge', author: 'x' }, { id: 'P2', title: 'Two sums', author: 'x' }, { id: 'P3', title: 'Graph walk', author: 'x' }];

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const renderAt = (path = '/admin/contests/7') => render(
  <RouterProvider router={createMemoryRouter([
    { path: '/admin/contests/:contestId/:tab?', element: <><ContestEditPage /><Where /></> },
  ], { initialEntries: [path] })} />,
);

describe('ContestEditPage', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.mocked(adminService.getContests).mockResolvedValue([contest(), contest({ id: 8, title: 'Other' })] as never);
    jest.mocked(adminService.getContestProblemsAdmin).mockResolvedValue(problems);
    jest.mocked(adminService.getAvailableProblems).mockResolvedValue([]);
    jest.mocked(adminService.updateContest).mockResolvedValue({} as never);
    jest.mocked(adminService.updateContestVisibility).mockResolvedValue({ message: 'ok' } as never);
    jest.mocked(adminService.getContestParticipants).mockResolvedValue([
      { user_id: 2, username: 'mint', joined_at: '2026-11-20T02:00:00.000Z' },
      { user_id: 3, username: 'arm', joined_at: '2026-11-20T02:30:00.000Z' },
    ]);
    jest.mocked(contestService.getScoreboard).mockResolvedValue({ scoreboard: [], problems: [] } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('header: breadcrumb, title with status, window and registered count, Open contest page; tabs carry counts', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Weekly 12\s*SCHEDULED/);
    expect(within(screen.getByRole('navigation', { name: /breadcrumb/i })).getByRole('link', { name: 'Contests' })).toHaveAttribute('href', '/admin/contests');
    expect(screen.getByText('27 Nov 2026, 19:00 – 21:00 · 2 registered')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open contest page' })).toHaveAttribute('href', '/contests/7');
    expect(await screen.findByRole('tab', { name: 'Problems 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Participants 2' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/contests/7/participants');
  });

  it('Settings shows the drawer fields filled in and saves Bangkok times as ISO', async () => {
    renderAt();
    const title = await screen.findByLabelText('Title');
    expect(title).toHaveValue('Weekly 12');
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-11-27');
    expect(screen.getByLabelText('Start time')).toHaveValue('19:00');
    expect(screen.getByRole('button', { name: '2 h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '20:30' } });
    fireEvent.click(screen.getByRole('button', { name: '3 h' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminService.updateContest).toHaveBeenCalledWith(7, {
      title: 'Weekly 12', description: 'Round twelve', startTime: '2026-11-27T13:30:00.000Z', endTime: '2026-11-27T16:30:00.000Z',
    }));
    expect(adminService.updateContestVisibility).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('Settings saves a visibility change through the visibility route', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('switch', { name: 'Visible to students' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminService.updateContestVisibility).toHaveBeenCalledWith(7, false));
  });

  it('a running contest can be edited without its start being in the future', async () => {
    jest.mocked(adminService.getContests).mockResolvedValue([contest({ status: 'running', start_time: '2026-11-20T02:00:00.000Z', end_time: '2026-11-20T05:00:00.000Z' })] as never);
    renderAt();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Weekly 12 (rerun)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminService.updateContest).toHaveBeenCalled());
  });

  it('Problems tab lists the contest problems', async () => {
    renderAt('/admin/contests/7/problems');
    expect(await screen.findByText('Interval merge')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('Participants: user, joined at and score, ordered by rank', async () => {
    jest.mocked(contestService.getScoreboard).mockResolvedValue({
      scoreboard: [
        { user_id: 3, username: 'arm', total_score: 250, rank: 1, detailed_scores: {}, last_score_improvement_time: null },
        { user_id: 2, username: 'mint', total_score: 100, rank: 2, detailed_scores: {}, last_score_improvement_time: null },
      ],
      problems: [],
    } as never);
    renderAt('/admin/contests/7/participants');
    const table = await screen.findByRole('table', { name: 'Participants' });
    await waitFor(() => expect(within(table).getAllByRole('row')[1]).toHaveTextContent(/1\s*arm\s*20 Nov 2026, 09:30\s*250/));
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent(/2\s*mint\s*20 Nov 2026, 09:00\s*100/);
  });

  it('an unknown contest says so', async () => {
    renderAt('/admin/contests/99');
    expect(await screen.findByText('Contest not found')).toBeInTheDocument();
  });
});
