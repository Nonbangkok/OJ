import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestsTab from '../features/admin/analysis/ContestsTab';
import ContestDetail from '../features/admin/analysis/ContestDetail';
import * as analyticsService from '../services/analyticsService';
import contestsAdminService from '../services/admin/contestsAdminService';

jest.mock('../services/analyticsService');
jest.mock('../services/admin/contestsAdminService', () => ({
    getContests: jest.fn(),
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

const mockGetContests = contestsAdminService.getContests as jest.MockedFunction<typeof contestsAdminService.getContests>;
const mockFetchContestAnalytics = analyticsService.fetchContestAnalytics as jest.MockedFunction<typeof analyticsService.fetchContestAnalytics>;

const mockContests = [
    {
        id: 1,
        title: 'Test Contest',
        description: null,
        start_time: '2026-09-01T08:00:00Z',
        end_time: '2026-09-01T11:00:00Z',
        status: 'finished' as const,
        participant_count: '8',
    },
    {
        id: 2,
        title: 'Running Contest',
        description: null,
        start_time: '2026-09-18T08:00:00Z',
        end_time: '2026-09-20T11:00:00Z',
        status: 'running' as const,
        participant_count: '3',
    },
];

const mockContestAnalytics = {
    contest: { contestId: 1, title: 'Test Contest', status: 'finished', startTime: '2026-09-01T08:00:00+00:00', endTime: '2026-09-01T11:00:00+00:00' },
    kpis: { participants: 8, submitters: 5, submissions: 40, accepted: 25, avgScore: 250.5, maxScore: 400 },
    submissionTimeline: [{ bucket: 'H0', count: 20 }, { bucket: 'H1', count: 20 }],
    problemStats: [
        { problemId: 'aplusb', title: 'A Plus B', submissions: 20, accepted: 15, acRate: 0.75, solvers: 4 },
    ],
    scoreboard: [
        { username: 'bob', totalScore: 300, solved: 3 },
    ],
};

describe('ContestsTab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetContests.mockResolvedValue(mockContests as never);
    });

    it('renders the contest picker from the admin service', async () => {
        render(
            <BrowserRouter>
                <ContestsTab onSelectContest={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('Test Contest')).toBeInTheDocument());
        expect(screen.getByText('Running Contest')).toBeInTheDocument();
        expect(screen.getByText('finished')).toBeInTheDocument();
    });

    it('calls onSelectContest when a contest is clicked', async () => {
        const onSelectContest = jest.fn();

        render(
            <BrowserRouter>
                <ContestsTab onSelectContest={onSelectContest} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('Test Contest')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /analyze.*test contest/i }));

        expect(onSelectContest).toHaveBeenCalledWith(1);
    });
});

describe('ContestDetail', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the contest analytics payload with a back button', async () => {
        mockFetchContestAnalytics.mockResolvedValueOnce(mockContestAnalytics);

        render(
            <BrowserRouter>
                <ContestDetail contestId={1} onBack={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('Test Contest')).toBeInTheDocument());
        expect(screen.getByText('bob')).toBeInTheDocument();
        expect(screen.getByText('300')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });

    it('renders an error when the fetch fails', async () => {
        mockFetchContestAnalytics.mockRejectedValueOnce(new Error('boom'));

        render(
            <BrowserRouter>
                <ContestDetail contestId={1} onBack={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
    });
});
