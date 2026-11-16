import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuestHome from '../../../features/home/GuestHome';
import contestService from '../../../services/contestService';
import problemService from '../../../services/problemService';

jest.mock('../../../services/contestService');
jest.mock('../../../services/problemService');

describe('GuestHome', () => {
  it('public guest home lists contests and problems to start with', async () => {
    jest.mocked(contestService.getAll).mockResolvedValue([
      { id: 9, title: 'Weekly #42', status: 'running', start_time: new Date(Date.now() - 3600e3).toISOString(), end_time: new Date(Date.now() + 3600e3).toISOString() },
      { id: 10, title: 'Old one', status: 'finished', start_time: '2026-01-01T00:00:00Z', end_time: '2026-01-01T03:00:00Z' },
    ] as never);
    jest.mocked(problemService.getProblemsPage).mockResolvedValue({
      problems: [{ id: 'easy', title: 'Easy one', author: null, difficulty: 800 }], nextCursor: null, hasMore: false,
    } as never);
    render(<MemoryRouter><GuestHome /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Grader' })).toBeInTheDocument();
    const contests = await screen.findByRole('region', { name: 'Contests' });
    expect(within(contests).getByText('Weekly #42')).toBeInTheDocument();
    expect(within(contests).queryByText('Old one')).toBeNull();
    expect(within(contests).getByRole('link', { name: 'Log in to join' })).toHaveAttribute('href', '/login?returnTo=%2Fcontests%2F9');
    expect(await screen.findByRole('link', { name: 'Easy one' })).toHaveAttribute('href', '/problems/easy');
    expect(problemService.getProblemsPage).toHaveBeenCalledWith({ sort: 'difficulty', order: 'asc', limit: 6 });
  });
});
