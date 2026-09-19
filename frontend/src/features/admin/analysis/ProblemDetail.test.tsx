import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ProblemDetail from './ProblemDetail';
import { fetchProblemAnalytics } from '../../../services/analyticsService';
import type { ProblemAnalytics } from '../../../services/analyticsService';

jest.mock('../../../services/analyticsService');

const mockFetch = fetchProblemAnalytics as jest.MockedFunction<typeof fetchProblemAnalytics>;

const sample: ProblemAnalytics = {
  problem: { id: 'aplusb', title: 'A Plus B' },
  kpis: { submissions: 30, accepted: 20, acRate: 0.66, uniqueSubmitters: 15 },
  dailySeries: [{ day: '2026-09-19', total: 5, accepted: 4 }],
  verdictBreakdown: [{ verdict: 'Accepted', count: 20 }],
  testcasePassRates: [{ caseNumber: 1, passRate: 0.9 }],
  runtimeBuckets: [{ bucket: '<100ms', count: 25 }],
  memoryBuckets: [{ bucket: '<50MB', count: 28 }],
  firstSolves: [{ userId: 1, username: 'alice', submittedAt: '2026-09-01T00:00:00Z' }],
};

describe('ProblemDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads analytics and renders the problem title with KPIs', async () => {
    mockFetch.mockResolvedValueOnce(sample);

    render(<MemoryRouter><ProblemDetail problemId="aplusb" onBack={jest.fn()} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('A Plus B')).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith('aplusb');
    expect(screen.getByText('Submissions')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('66%')).toBeInTheDocument();
  });

  it('shows an error with a back button when the fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));

    render(<MemoryRouter><ProblemDetail problemId="aplusb" onBack={jest.fn()} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/failed to load problem analytics/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /back to problems/i })).toBeInTheDocument();
  });
});
