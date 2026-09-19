import { render, screen, waitFor } from '@testing-library/react';

import UserDetail from './UserDetail';
import { fetchUserAnalytics } from '../../../services/analyticsService';
import type { UserAnalytics } from '../../../services/analyticsService';

jest.mock('../../../services/analyticsService');

const mockFetchUserAnalytics = fetchUserAnalytics as jest.MockedFunction<typeof fetchUserAnalytics>;

const sampleAnalytics: UserAnalytics = {
  user: { id: 7, username: 'alice', role: 'user', createdAt: '2026-01-01T00:00:00Z' },
  kpis: { submissions: 20, solved: 5, attempted: 8, acRate: 0.25, totalScore: 500 },
  dailySeries: [{ day: '2026-09-19', count: 3 }],
  hourHistogram: [{ hour: 10, count: 2 }],
  verdictBreakdown: [{ verdict: 'Accepted', count: 5 }],
  languageBreakdown: [{ language: 'cpp', count: 20 }],
  cumulativeSolved: [{ day: '2026-09-19', solved: 5 }],
  solvedByCategory: [{ category: 'math', solved: 3, attempted: 4 }],
};

describe('UserDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads analytics for the given user and renders KPIs', async () => {
    mockFetchUserAnalytics.mockResolvedValueOnce(sampleAnalytics);

    render(<UserDetail userId={7} onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    expect(mockFetchUserAnalytics).toHaveBeenCalledWith(7);
    expect(screen.getByText('Submissions')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('renders chart sections for verdicts, language usage, and activity', async () => {
    mockFetchUserAnalytics.mockResolvedValueOnce(sampleAnalytics);

    render(<UserDetail userId={7} onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    // Chart data renders into SVG (not text in jsdom), so assert on the
    // section headings that carry the breakdowns.
    expect(screen.getByText('Language usage')).toBeInTheDocument();
    expect(screen.getByText('Verdicts')).toBeInTheDocument();
    expect(screen.getByText(/activity/i)).toBeInTheDocument();
  });

  it('shows an error with a back button when the fetch fails', async () => {
    mockFetchUserAnalytics.mockRejectedValueOnce(new Error('boom'));

    render(<UserDetail userId={7} onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load user analytics/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /back to users/i })).toBeInTheDocument();
  });

  it('reloads when the userId changes', async () => {
    mockFetchUserAnalytics.mockResolvedValue(sampleAnalytics);

    const { rerender } = render(<UserDetail userId={7} onBack={jest.fn()} />);
    rerender(<UserDetail userId={8} onBack={jest.fn()} />);

    await waitFor(() => {
      expect(mockFetchUserAnalytics).toHaveBeenCalledTimes(2);
      expect(mockFetchUserAnalytics).toHaveBeenLastCalledWith(8);
    });
  });
});
