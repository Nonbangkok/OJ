import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import UserCompare from './UserCompare';
import { fetchUserAnalytics } from '../../../services/analyticsService';
import type { UserAnalytics } from '../../../services/analyticsService';

jest.mock('../../../services/analyticsService');

const mockFetch = fetchUserAnalytics as jest.MockedFunction<typeof fetchUserAnalytics>;

const makeUser = (name: string, solved: number): UserAnalytics => ({
  user: { id: 1, username: name, role: 'user', createdAt: '2026-01-01T00:00:00Z' },
  kpis: { submissions: solved * 4, solved, attempted: solved + 3, acRate: 0.25, totalScore: solved * 100 },
  dailySeries: [],
  hourHistogram: [],
  verdictBreakdown: [],
  languageBreakdown: [],
  cumulativeSolved: [],
  solvedByCategory: [],
});

describe('UserCompare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads both users and renders the versus table', async () => {
    mockFetch
      .mockResolvedValueOnce(makeUser('alice', 10))
      .mockResolvedValueOnce(makeUser('bob', 5));

    render(
      <MemoryRouter>
        <UserCompare userIds={[1, 2]} onBack={jest.fn()} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /alice vs bob/i })).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(1);
    expect(mockFetch).toHaveBeenCalledWith(2);

    const rows = screen.getAllByRole('row');
    // header + 5 metric rows
    expect(rows.length).toBe(6);
    expect(screen.getByText('40')).toBeInTheDocument(); // alice submissions
    expect(screen.getByText('20')).toBeInTheDocument(); // bob submissions
  });

  it('shows an error with a back button when a fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));

    render(
      <MemoryRouter>
        <UserCompare userIds={[1, 2]} onBack={jest.fn()} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/failed to load user analytics/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /back to users/i })).toBeInTheDocument();
  });

  it('shows a loading state while fetching', () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter>
        <UserCompare userIds={[1, 2]} onBack={jest.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByText(/loading comparison/i)).toBeInTheDocument();
  });
});
