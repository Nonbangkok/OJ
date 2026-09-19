import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ProblemsTab from '../features/admin/analysis/ProblemsTab';
import ProblemDetail from '../features/admin/analysis/ProblemDetail';
import * as analyticsService from '../services/analyticsService';
import problemsAdminService from '../services/admin/problemsAdminService';

jest.mock('../services/analyticsService');
jest.mock('../services/admin/problemsAdminService', () => ({
    getProblems: jest.fn(),
}));

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

const mockFetchAnalyticsProblems = analyticsService.fetchAnalyticsProblems as jest.MockedFunction<typeof analyticsService.fetchAnalyticsProblems>;
const mockFetchProblemAnalytics = analyticsService.fetchProblemAnalytics as jest.MockedFunction<typeof analyticsService.fetchProblemAnalytics>;

const mockProblems = [
    { problemId: 'aplusb', title: 'A Plus B', category: 'math', submissions: 30, accepted: 20, acRate: 0.667, solvers: 8 },
    { problemId: 'gcd', title: 'GCD', category: 'math', submissions: 5, accepted: 1, acRate: 0.2, solvers: 1 },
];

const mockProblemAnalytics = {
    problem: { id: 'aplusb', title: 'A Plus B' },
    kpis: { submissions: 10, accepted: 7, acRate: 0.7, uniqueSubmitters: 5 },
    dailySeries: [{ day: '2026-09-19', total: 2, accepted: 1 }],
    verdictBreakdown: [{ verdict: 'Accepted', count: 7 }, { verdict: 'Wrong Answer', count: 3 }],
    testcasePassRates: [{ caseNumber: 3, passRate: 0.7 }],
    runtimeBuckets: [{ bucket: '0-100ms', count: 4 }],
    memoryBuckets: [{ bucket: '0-50MB', count: 4 }],
    firstSolves: [{ userId: 2, username: 'bob', submittedAt: '2026-02-01T00:00:00Z' }],
};

describe('ProblemsTab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchAnalyticsProblems.mockResolvedValue({ problems: mockProblems });
    });

    it('renders the problem table with stats from the service', async () => {
        render(
            <BrowserRouter>
                <ProblemsTab onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());
        expect(screen.getByText('GCD')).toBeInTheDocument();
        expect(screen.getByText('67%')).toBeInTheDocument();
        expect(screen.getByText('8')).toBeInTheDocument();
    });

    it('calls onSelectProblem when a problem is clicked', async () => {
        const onSelectProblem = jest.fn();

        render(
            <BrowserRouter>
                <ProblemsTab onSelectProblem={onSelectProblem} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /analyze.*a plus b/i }));

        expect(onSelectProblem).toHaveBeenCalledWith('aplusb');
    });

    it('sorts by AC rate when the header is clicked', async () => {
        render(
            <BrowserRouter>
                <ProblemsTab onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /ac rate/i }));

        await waitFor(() => expect(mockFetchAnalyticsProblems).toHaveBeenCalledWith(
            expect.objectContaining({ sortBy: 'acRate', sortDir: 'desc' }),
        ));
    });

    it('triggers a search fetch with the typed term', async () => {
        render(
            <BrowserRouter>
                <ProblemsTab onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());

        fireEvent.change(screen.getByRole('textbox', { name: /search problems/i }), { target: { value: 'plus' } });

        await waitFor(() => expect(mockFetchAnalyticsProblems).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'plus' }),
        ));
    });
});

describe('ProblemDetail', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the problem analytics payload with a back button', async () => {
        mockFetchProblemAnalytics.mockResolvedValueOnce(mockProblemAnalytics);

        render(
            <BrowserRouter>
                <ProblemDetail problemId="aplusb" onBack={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());
        expect(screen.getByText('70%')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
    });

    it('renders an error when the fetch fails', async () => {
        mockFetchProblemAnalytics.mockRejectedValueOnce(new Error('boom'));

        render(
            <BrowserRouter>
                <ProblemDetail problemId="aplusb" onBack={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
    });
});
