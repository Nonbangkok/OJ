import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Contests from '../../pages/contest/Contests';
import contestService from '../../services/contestService';
import { useAuth } from '../../context/AuthContext';
import type { Contest } from '../../types';

jest.mock('../../services/contestService');
jest.mock('../../context/ThemeContext', () => ({ useTheme: jest.fn(() => ({ theme: 'light' })) }));
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Contests...</div>);
jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const contest = (id: number, over: Partial<Contest>): Contest => ({
  id, title: `Contest ${id}`, description: null, status: 'scheduled',
  start_time: iso(HOUR), end_time: iso(3 * HOUR), participant_count: '0', problem_count: 3,
  is_participant: false, is_visible: true, ...over,
} as Contest);

const all = [
  contest(1, { title: 'Mid-term practice', status: 'running', start_time: iso(-HOUR), end_time: iso(HOUR), is_participant: true, participant_count: '86', problem_count: 5 }),
  contest(2, { title: 'Open sprint', status: 'running', start_time: iso(-HOUR), end_time: iso(HOUR) }),
  contest(3, { title: 'Weekly round #19', is_participant: true, participant_count: '12', problem_count: 6 }),
  contest(4, { title: 'Graph camp', is_visible: false, participant_count: '1', problem_count: 1 }),
  contest(5, { title: 'Weekly round #18', status: 'finished', start_time: iso(-50 * HOUR), end_time: iso(-48 * HOUR) }),
];

const renderPage = (role = 'user') => {
  jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'n', role }, isLoading: false } as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={['/contests']}>
      <Routes>
        <Route path="/contests" element={<Contests />} />
        <Route path="/contests/:id/*" element={<p>contest page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};
const row = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

describe('Contests page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(contestService.getAll).mockResolvedValue(all);
  });

  it('groups into Live / Upcoming / Past and hides empty groups', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Live' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Past' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Live' })).getByText('Mid-term practice')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Past' })).getByText('Weekly round #18')).toBeInTheDocument();
  });

  it('hides a group with no contests', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([all[4]]);
    renderPage();
    await screen.findByRole('heading', { name: 'Past' });
    expect(screen.queryByRole('heading', { name: 'Live' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Upcoming' })).toBeNull();
  });

  it('shows one action per state', async () => {
    renderPage();
    await screen.findByText('Mid-term practice');
    expect(within(row('Mid-term practice')).getByRole('link', { name: 'Enter' })).toHaveAttribute('href', '/contests/1/problems');
    expect(within(row('Open sprint')).getByRole('button', { name: 'Join' })).toBeInTheDocument();
    expect(within(row('Weekly round #19')).getByRole('link', { name: 'Registered' })).toHaveAttribute('href', '/contests/3');
    expect(within(row('Graph camp')).getByRole('button', { name: 'Join' })).toBeInTheDocument();
    expect(within(row('Weekly round #18')).getByRole('link', { name: 'Results' })).toHaveAttribute('href', '/contests/5');
  });

  it('joining a running contest opens it', async () => {
    jest.mocked(contestService.join).mockResolvedValue({ message: 'ok' } as never);
    renderPage();
    await screen.findByText('Open sprint');
    fireEvent.click(within(row('Open sprint')).getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('contest page')).toBeInTheDocument();
    expect(contestService.join).toHaveBeenCalledWith(2);
  });

  it('meta line "n joined · n problems", pluralised', async () => {
    renderPage();
    await screen.findByText('Mid-term practice');
    expect(within(row('Mid-term practice')).getByText('86 joined · 5 problems')).toBeInTheDocument();
    expect(within(row('Graph camp')).getByText('1 joined · 1 problem')).toBeInTheDocument();
  });

  it('staff see HIDDEN on hidden contests; students never do', async () => {
    const { unmount } = renderPage('user');
    await screen.findByText('Graph camp');
    expect(screen.queryByText('HIDDEN')).toBeNull();
    unmount();
    renderPage('staff');
    await screen.findByText('Graph camp');
    expect(within(row('Graph camp')).getByText('HIDDEN')).toBeInTheDocument();
  });

  it('"No contests yet." when empty', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No contests yet.')).toBeInTheDocument();
  });

  it('PageHeader meta counts each group', async () => {
    renderPage();
    expect(await screen.findByText('2 live · 2 upcoming · 1 past')).toBeInTheDocument();
  });
});
