import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ContestDetail from './ContestDetail';
import { fetchContestAnalytics } from '../../../services/analyticsService';
import type { ContestAnalytics } from '../../../services/analyticsService';
import { fetchContestSimilarity } from '../../../services/contestService';

jest.mock('../../../services/analyticsService');
jest.mock('../../../services/contestService', () => ({
  fetchContestSimilarity: jest.fn().mockResolvedValue({ contestId: 3, pairs: [] }),
}));

const mockFetch = fetchContestAnalytics as jest.MockedFunction<typeof fetchContestAnalytics>;

const sample: ContestAnalytics = {
  contest: { contestId: 3, title: 'Contest 3', status: 'finished', startTime: '2026-09-01T00:00:00Z', endTime: '2026-09-02T00:00:00Z' },
  kpis: { participants: 8, submitters: 6, submissions: 40, accepted: 25, avgScore: 250.5, maxScore: 300 },
  submissionTimeline: [{ bucket: '10:00', count: 12 }],
  problemStats: [{ problemId: 'aplusb', title: 'A Plus B', submissions: 20, accepted: 15, acRate: 0.75, solvers: 10 }],
  scoreboard: [{ username: 'alice', totalScore: 300, solved: 3 }],
};

describe('ContestDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads analytics and renders the contest title with KPIs', async () => {
    mockFetch.mockResolvedValueOnce(sample);

    render(<MemoryRouter><ContestDetail contestId={3} onBack={jest.fn()} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Contest 3')).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(3);
    expect(screen.getByText('Participants')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders the scoreboard section', async () => {
    mockFetch.mockResolvedValueOnce(sample);

    render(<MemoryRouter><ContestDetail contestId={3} onBack={jest.fn()} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/scoreboard/i)).toBeInTheDocument();
    });
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('renders the similar-submissions (cheat detection) section', async () => {
    mockFetch.mockResolvedValueOnce(sample);
    jest.mocked(fetchContestSimilarity).mockResolvedValueOnce({
      contestId: 3,
      pairs: [{
        problemId: 'aplusb', userA: 'alice', userB: 'bob',
        similarity: 0.93, submissionIdA: 1, submissionIdB: 2,
      }],
    });

    render(
      <MemoryRouter>
        <ContestDetail contestId={3} onBack={jest.fn()} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/similar submissions/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText('alice').length).toBeGreaterThanOrEqual(2); // scoreboard + similarity row
    expect(screen.getByText('93%')).toBeInTheDocument();
  });

  it('shows an error with a back button when the fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));

    render(<MemoryRouter><ContestDetail contestId={3} onBack={jest.fn()} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/failed to load contest analytics/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /back to contests/i })).toBeInTheDocument();
  });
});
