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

const mockGetProblems = problemsAdminService.getProblems as jest.MockedFunction<typeof problemsAdminService.getProblems>;
const mockFetchProblemAnalytics = analyticsService.fetchProblemAnalytics as jest.MockedFunction<typeof analyticsService.fetchProblemAnalytics>;

const mockProblems = [
    { id: 'aplusb', title: 'A Plus B', author: 'someone', category: 'math', is_visible: true, contest_id: null, contest_status: null },
    { id: 'gcd', title: 'GCD', author: 'someone', category: 'math', is_visible: true, contest_id: null, contest_status: null },
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
        mockGetProblems.mockResolvedValue(mockProblems as never);
    });

    it('renders the problem picker from the admin service', async () => {
        render(
            <BrowserRouter>
                <ProblemsTab onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());
        expect(screen.getByText('GCD')).toBeInTheDocument();
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
