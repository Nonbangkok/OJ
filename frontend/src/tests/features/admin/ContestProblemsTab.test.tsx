import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContestProblemsTab from '../../../features/admin/contests/ContestProblemsTab';
import adminService from '../../../services/adminService';
import type { ContestStatus, ProblemBase } from '../../../types';

jest.mock('../../../services/adminService');

const p = (id: string, title: string): ProblemBase => ({ id, title, author: 'x' });
const initial = [p('P1', 'Interval merge'), p('P2', 'Two sums'), p('P3', 'Graph walk')];

function Harness({ status = 'scheduled' as ContestStatus, start = initial }: { status?: ContestStatus; start?: ProblemBase[] }) {
  const [problems, setProblems] = useState(start);
  return <ContestProblemsTab contestId={7} status={status} problems={problems} onProblemsChange={setProblems} />;
}

const rows = () => screen.getAllByRole('listitem');
const order = () => rows().map((r) => r.textContent);

describe('ContestProblemsTab', () => {
  beforeEach(() => {
    jest.mocked(adminService.reorderProblems).mockResolvedValue(undefined);
    jest.mocked(adminService.getAvailableProblems).mockResolvedValue([p('Q9', 'Prime sieve'), p('Q10', 'Knapsack')]);
    jest.mocked(adminService.migrateContestProblems).mockResolvedValue({ message: 'ok' } as never);
    jest.mocked(adminService.removeContestProblem).mockResolvedValue({ message: 'ok' });
    jest.mocked(adminService.getContestProblemsAdmin).mockResolvedValue(initial);
  });

  it('lists the problems in order with a letter, title, id, handle and remove', () => {
    render(<Harness />);
    expect(order()[0]).toMatch(/^A\s*Interval merge\s*P1/);
    expect(order()[2]).toMatch(/^C\s*Graph walk\s*P3/);
    const first = rows()[0];
    expect(within(first).getByRole('button', { name: 'Drag P1 to reorder' })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Remove P1' })).toBeInTheDocument();
  });

  it('a drop sends the new full order and the letters follow', async () => {
    render(<Harness />);
    fireEvent.dragStart(rows()[2]);
    fireEvent.dragOver(rows()[0]);
    fireEvent.drop(rows()[0]);
    await waitFor(() => expect(adminService.reorderProblems).toHaveBeenCalledWith(7, ['P3', 'P1', 'P2']));
    expect(order()[0]).toMatch(/^A\s*Graph walk/);
    expect(order()[1]).toMatch(/^B\s*Interval merge/);
  });

  it('a drop in place sends nothing', () => {
    render(<Harness />);
    fireEvent.dragStart(rows()[1]);
    fireEvent.dragOver(rows()[1]);
    fireEvent.drop(rows()[1]);
    expect(adminService.reorderProblems).not.toHaveBeenCalled();
  });

  it('a refused reorder shows the server\'s order again and says why', async () => {
    jest.mocked(adminService.reorderProblems).mockRejectedValue({ response: { status: 409, data: { message: 'Problems can only be reordered before the contest ends' } } });
    render(<Harness />);
    fireEvent.dragStart(rows()[2]);
    fireEvent.drop(rows()[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Problems can only be reordered before the contest ends');
    await waitFor(() => expect(order()[0]).toMatch(/^A\s*Interval merge/));
    expect(adminService.getContestProblemsAdmin).toHaveBeenCalledWith(7);
  });

  it('one reorder at a time: a second move waits until the first is saved', async () => {
    let settle: (value?: unknown) => void = () => {};
    jest.mocked(adminService.reorderProblems).mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }) as never);
    render(<Harness />);
    fireEvent.dragStart(rows()[2]);
    fireEvent.drop(rows()[0]);
    expect(within(rows()[0]).queryByRole('button', { name: /^Drag/ })).toBeDisabled();
    fireEvent.dragStart(rows()[2]);
    fireEvent.drop(rows()[0]);
    expect(adminService.reorderProblems).toHaveBeenCalledTimes(1);
    settle();
    await waitFor(() => expect(within(rows()[0]).getByRole('button', { name: /^Drag/ })).toBeEnabled());
    expect(order().map((t) => t?.match(/P\d/)?.[0])).toEqual(['P3', 'P1', 'P2']);
  });

  it('Move up / Move down in each row menu reorder for keyboard users', async () => {
    const user = userEvent.setup({ delay: 20 });
    render(<Harness />);
    await user.click(within(rows()[1]).getByRole('button', { name: 'More actions for P2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(adminService.reorderProblems).toHaveBeenCalledWith(7, ['P2', 'P1', 'P3']));
    await user.click(within(rows()[2]).getByRole('button', { name: 'More actions for P3' }));
    expect(await screen.findByRole('menuitem', { name: 'Move down' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('remove is a plain confirm that returns the problem to the practice set', async () => {
    jest.mocked(adminService.getContestProblemsAdmin).mockResolvedValue([initial[0], initial[2]]);
    render(<Harness />);
    fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Remove P2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Two sums?' });
    expect(dialog).toHaveTextContent('returns it to the practice set');
    expect(dialog).toHaveTextContent('Points scored on it stop counting in the standings.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove problem' }));
    await waitFor(() => expect(adminService.removeContestProblem).toHaveBeenCalledWith(7, 'P2'));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it('adds a problem from the searchable picker', async () => {
    jest.mocked(adminService.getContestProblemsAdmin).mockResolvedValue([...initial, p('Q9', 'Prime sieve')]);
    render(<Harness />);
    const picker = screen.getByRole('combobox', { name: 'Add a problem by id or title…' });
    fireEvent.change(picker, { target: { value: 'prime' } });
    const option = await screen.findByRole('option', { name: /Prime sieve/ });
    expect(screen.queryByRole('option', { name: /Knapsack/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(adminService.migrateContestProblems).toHaveBeenCalledWith(7, ['Q9'], 'move_to_contest'));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(order()[3]).toMatch(/^D\s*Prime sieve/);
  });

  it('after the contest ends the list is read-only and says so', () => {
    render(<Harness status="finished" />);
    expect(screen.getByText("Problems can't be added or removed after the contest ends.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drag|Remove|More actions/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(order()[0]).toMatch(/^A\s*Interval merge/);
  });
});
