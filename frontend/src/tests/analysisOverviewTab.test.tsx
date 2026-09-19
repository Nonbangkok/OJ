import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import OverviewTab from '../features/admin/analysis/OverviewTab';
import * as analyticsService from '../services/analyticsService';

jest.mock('../services/analyticsService');
jest.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => children ?? null,
    LineChart: () => null,
    BarChart: () => null,
    PieChart: () => null,
    Line: () => null,
    Bar: () => null,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    CartesianGrid: () => null,
}));

const mockFetchOverview = analyticsService.fetchOverview as jest.MockedFunction<typeof analyticsService.fetchOverview>;

const mockOverview = {
    kpis: {
        submissions: { current: 100, previous: 80 },
        uniqueSubmitters: { current: 10, previous: 8 },
        accepted: { current: 60, previous: 40 },
        newUsers: { current: 5, previous: 3 },
        activeProblems: { current: 2, previous: 1 },
    },
    dailySeries: [
        { day: '2026-09-18', total: 12, accepted: 7 },
        { day: '2026-09-19', total: 10, accepted: 6 },
    ],
    verdictBreakdown: [
        { verdict: 'Accepted', count: 60 },
        { verdict: 'Wrong Answer', count: 40 },
    ],
    topProblems: [
        { problemId: 'aplusb', title: 'A Plus B', submissions: 30, accepted: 20 },
    ],
    topSubmitters: [
        { userId: 1, username: 'alice', submissions: 15, solved: 5 },
    ],
    contestStats: [
        { contestId: 1, title: 'Contest 1', status: 'finished', submissions: 40, participants: 8, avgScore: 250.5 },
    ],
};

describe('OverviewTab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders KPI cards with values and deltas from the service', async () => {
        mockFetchOverview.mockResolvedValueOnce(mockOverview);

        render(
            <BrowserRouter>
                <OverviewTab />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('100')).toBeInTheDocument());
        // +25% delta for 80 -> 100 (multiple KPIs share the same delta)
        expect(screen.getAllByText('+25%').length).toBeGreaterThan(0);
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('A Plus B')).toBeInTheDocument();
        expect(screen.getByText('Contest 1')).toBeInTheDocument();
    });

    it('refetches with 7 when the 7-day button is clicked', async () => {
        mockFetchOverview.mockResolvedValue(mockOverview);

        render(
            <BrowserRouter>
                <OverviewTab />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('100')).toBeInTheDocument());
        expect(mockFetchOverview).toHaveBeenCalledWith(30);

        fireEvent.click(screen.getByRole('button', { name: '7 days' }));

        await waitFor(() => expect(mockFetchOverview).toHaveBeenCalledWith(7));
    });

    it('fetches all-time (days=0) and hides deltas', async () => {
        mockFetchOverview.mockResolvedValue(mockOverview);

        render(
            <BrowserRouter>
                <OverviewTab />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('100')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'All time' }));

        await waitFor(() => expect(mockFetchOverview).toHaveBeenCalledWith(0));
        // Deltas are meaningless for all-time and must disappear.
        expect(screen.queryByText('+25%')).not.toBeInTheDocument();
    });

    it('renders an error message when the fetch fails', async () => {
        mockFetchOverview.mockRejectedValueOnce(new Error('Network error'));

        render(
            <BrowserRouter>
                <OverviewTab />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
    });

    it('renders a loading state while fetching', async () => {
        mockFetchOverview.mockReturnValue(new Promise(() => { /* pending forever */ }));

        render(
            <BrowserRouter>
                <OverviewTab />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
});
