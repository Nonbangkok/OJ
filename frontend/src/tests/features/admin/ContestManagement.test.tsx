import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ContestManagement from '../../../features/admin/contests/ContestManagement';
import adminService from '../../../services/adminService';
import { useAuth } from '../../../context/AuthContext';

jest.mock('../../../services/adminService');
jest.mock('../../../context/AuthContext');

const NOW = Date.parse('2026-11-20T03:00:00.000Z');
const contests = [
  { id: 1, title: 'Weekly 12', description: null, status: 'scheduled', start_time: '2026-11-27T12:00:00.000Z', end_time: '2026-11-27T14:00:00.000Z', participant_count: '5', problem_count: 3, is_visible: true },
  { id: 2, title: 'Mid-term practice', description: null, status: 'running', start_time: '2026-11-20T02:00:00.000Z', end_time: '2026-11-20T04:12:08.000Z', participant_count: '41', problem_count: 6, is_visible: true },
  { id: 3, title: 'Old round', description: null, status: 'finished', start_time: '2026-01-01T03:00:00.000Z', end_time: '2026-01-01T06:30:00.000Z', participant_count: '20', problem_count: 4, is_visible: false },
];

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const renderList = () => render(
  <MemoryRouter initialEntries={['/admin/contests']}>
    <Routes>
      <Route path="/admin/contests" element={<><ContestManagement /><Where /></>} />
      <Route path="/admin/contests/:contestId/:tab?" element={<Where />} />
      <Route path="/contests/:contestId" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const rowOf = async (title: string) => (await screen.findByRole('link', { name: title })).closest('tr') as HTMLElement;
const openMenu = async (title: string) => {
  const user = userEvent.setup({ delay: 20 });
  await user.click(within(await rowOf(title)).getByRole('button', { name: `Actions for ${title}` }));
  return user;
};

describe('ContestManagement (§7.8)', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'admin' } } as ReturnType<typeof useAuth>);
    jest.mocked(adminService.getContests).mockResolvedValue(contests as never);
    jest.mocked(adminService.updateContestVisibility).mockResolvedValue({ message: 'ok', contest: { ...contests[0], is_visible: false } } as never);
    jest.mocked(adminService.deleteContest).mockResolvedValue({ message: 'ok' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('header says the timezone and offers New contest; status segments filter', async () => {
    renderList();
    expect(await screen.findByText('Times are Asia/Bangkok (UTC+7)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New contest' })).toBeInTheDocument();
    await rowOf('Weekly 12');
    fireEvent.click(screen.getByRole('button', { name: 'Running' }));
    expect(screen.queryByRole('link', { name: 'Weekly 12' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Mid-term practice' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('link', { name: 'Weekly 12' })).toBeInTheDocument();
  });

  it('rows: title link, status with time left, start, duration, counts and visibility', async () => {
    renderList();
    const weekly = await rowOf('Weekly 12');
    expect(within(weekly).getByRole('link', { name: 'Weekly 12' })).toHaveAttribute('href', '/admin/contests/1');
    expect(weekly).toHaveTextContent('Scheduled');
    expect(weekly).toHaveTextContent('27 Nov 2026, 19:00');
    expect(weekly).toHaveTextContent('2 h');
    expect(within(await rowOf('Mid-term practice')).getByText('Running · 1:12:08 left')).toBeInTheDocument();
    const old = await rowOf('Old round');
    expect(old).toHaveTextContent('Finished');
    expect(old).toHaveTextContent('3 h 30 m');
    expect(old).toHaveTextContent('Hidden');
    expect(old).toHaveTextContent(/20\s*4/);
  });

  it('row menu: Edit opens the editor', async () => {
    renderList();
    const user = await openMenu('Weekly 12');
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/contests\/1$/);
  });

  it('row menu: Open contest page goes to the student view', async () => {
    renderList();
    const user = await openMenu('Weekly 12');
    await user.click(await screen.findByRole('menuitem', { name: 'Open contest page' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/contests\/1$/);
  });

  it('Show/Hide from the menu updates the row', async () => {
    renderList();
    const user = await openMenu('Weekly 12');
    await user.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    await waitFor(() => expect(adminService.updateContestVisibility).toHaveBeenCalledWith(1, false));
    expect(await rowOf('Weekly 12')).toHaveTextContent('Hidden');
  });

  it('Delete asks for the title and is disabled while running', async () => {
    renderList();
    let user = await openMenu('Mid-term practice');
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    user = await openMenu('Weekly 12');
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Weekly 12?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete contest' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Weekly 12' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(adminService.deleteContest).toHaveBeenCalledWith(1));
  });

  it('admins can rejudge a contest from the menu', async () => {
    renderList();
    await openMenu('Weekly 12');
    expect(await screen.findByRole('menuitem', { name: 'Rejudge' })).toBeInTheDocument();
  });

  it('staff do not get Rejudge (the server route is admin-only)', async () => {
    jest.mocked(useAuth).mockReturnValue({ user: { id: 2, username: 'ta', role: 'staff' } } as ReturnType<typeof useAuth>);
    renderList();
    await openMenu('Weekly 12');
    await screen.findByRole('menuitem', { name: 'Open contest page' });
    expect(screen.queryByRole('menuitem', { name: 'Rejudge' })).toBeNull();
  });
});

describe('Create contest drawer', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'admin' } } as ReturnType<typeof useAuth>);
    jest.mocked(adminService.getContests).mockResolvedValue([] as never);
    jest.mocked(adminService.createContest).mockResolvedValue({ id: 9, title: 'Weekly 13' } as never);
    jest.mocked(adminService.updateContestVisibility).mockResolvedValue({ message: 'ok' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const openDrawer = async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'New contest' }));
    return screen.findByRole('dialog', { name: 'New contest' });
  };

  it('posts Bangkok start and end as ISO, then opens the Problems tab', async () => {
    const drawer = await openDrawer();
    expect(drawer).toHaveTextContent('Times are Asia/Bangkok (UTC+7)');
    fireEvent.change(within(drawer).getByLabelText('Title'), { target: { value: 'Weekly 13' } });
    fireEvent.change(within(drawer).getByLabelText('Start date'), { target: { value: '2026-11-27' } });
    fireEvent.change(within(drawer).getByLabelText('Start time'), { target: { value: '19:00' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '2 h' }));
    expect(drawer).toHaveTextContent('Ends Fri 27 Nov, 21:00');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create contest' }));
    await waitFor(() => expect(adminService.createContest).toHaveBeenCalledWith({
      title: 'Weekly 13', description: '', startTime: '2026-11-27T12:00:00.000Z', endTime: '2026-11-27T14:00:00.000Z',
    }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/contests/9/problems'));
    expect(adminService.updateContestVisibility).not.toHaveBeenCalled();
  });

  it('offers 15-minute start times, accepts a free time, and supports a custom duration', async () => {
    const drawer = await openDrawer();
    const time = within(drawer).getByLabelText('Start time');
    const options = Array.from(document.getElementById(time.getAttribute('list') as string)?.querySelectorAll('option') ?? []).map((o) => o.getAttribute('value'));
    expect(options).toHaveLength(96);
    expect(options.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    fireEvent.change(within(drawer).getByLabelText('Title'), { target: { value: 'Odd' } });
    fireEvent.change(within(drawer).getByLabelText('Start date'), { target: { value: '2026-11-27' } });
    fireEvent.change(time, { target: { value: '19:07' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Custom' }));
    fireEvent.change(within(drawer).getByLabelText('Hours'), { target: { value: '1' } });
    fireEvent.change(within(drawer).getByLabelText('Minutes'), { target: { value: '45' } });
    expect(drawer).toHaveTextContent('Ends Fri 27 Nov, 20:52');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create contest' }));
    await waitFor(() => expect(adminService.createContest).toHaveBeenCalledWith(expect.objectContaining({
      startTime: '2026-11-27T12:07:00.000Z', endTime: '2026-11-27T13:52:00.000Z',
    })));
  });

  it('a hidden new contest is hidden right after it is created', async () => {
    const drawer = await openDrawer();
    fireEvent.change(within(drawer).getByLabelText('Title'), { target: { value: 'Secret' } });
    fireEvent.change(within(drawer).getByLabelText('Start date'), { target: { value: '2026-11-27' } });
    fireEvent.change(within(drawer).getByLabelText('Start time'), { target: { value: '19:00' } });
    fireEvent.click(within(drawer).getByRole('switch', { name: 'Visible to students' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create contest' }));
    await waitFor(() => expect(adminService.updateContestVisibility).toHaveBeenCalledWith(9, false));
  });

  it('refuses a start in the past or a malformed time without posting', async () => {
    const drawer = await openDrawer();
    fireEvent.change(within(drawer).getByLabelText('Title'), { target: { value: 'Late' } });
    fireEvent.change(within(drawer).getByLabelText('Start date'), { target: { value: '2026-11-19' } });
    fireEvent.change(within(drawer).getByLabelText('Start time'), { target: { value: '19:00' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create contest' }));
    expect(await within(drawer).findByText('Start must be in the future.')).toBeInTheDocument();
    fireEvent.change(within(drawer).getByLabelText('Start time'), { target: { value: '7pm' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create contest' }));
    expect(await within(drawer).findByText('Use 24-hour time, e.g. 19:00.')).toBeInTheDocument();
    expect(adminService.createContest).not.toHaveBeenCalled();
  });
});
