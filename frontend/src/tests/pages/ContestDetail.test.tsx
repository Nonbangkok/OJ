import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestDetail from '../../pages/contest/ContestDetail';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Contest Data...</div>);
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ contestId: '1' }),
    useNavigate: () => jest.fn()
}));

jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, username: 'testuser', role: 'user' }, isLoading: false, login: jest.fn(), logout: jest.fn() })
}));

describe('ContestDetail Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders loading state initially', () => {
        jest.mocked(contestService.getById).mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><ContestDetail /></BrowserRouter>);
        expect(screen.getByText(/loading contest data\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays contest details successfully', async () => {
        const mockContest = {
            id: 1, title: 'Test Contest', status: 'running' as const,
            description: null,
            problems: [{ id: 'P1', title: 'Problem 1', author: null }],
            is_participant: true,
            start_time: '2026-01-01T00:00:00Z',
            end_time: '2026-01-02T00:00:00Z',
            participant_count: '5'
        };
        // The detail hook polls, so a Once-mock would be consumed by the
        // refetch and leave the page in its error state.
        jest.mocked(contestService.getById).mockResolvedValue(mockContest as never);

        render(<BrowserRouter><ContestDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Test Contest')).toBeInTheDocument();
        });
    });

    it('shows compact metadata, live progress, and a solving action', async () => {
        const mockContest = {
            id: 1, title: 'Test Contest', status: 'running' as const,
            description: null,
            problems: [{ id: 'P1', title: 'Problem 1', author: null }],
            is_participant: true,
            start_time: '2026-01-01T00:00:00Z',
            end_time: '2026-01-02T00:00:00Z',
            participant_count: '5'
        };
        jest.mocked(contestService.getById).mockResolvedValue(mockContest as never);
        // Per-user problem summaries power the "X / N solved" progress block.
        jest.mocked(contestService.getProblems).mockResolvedValue([
            { id: 'P1', title: 'Problem 1', author: null, best_score: 100, submission_count: '1' },
            { id: 'P2', title: 'Problem 2', author: null, best_score: 0, submission_count: '0' },
        ] as never);

        render(<BrowserRouter><ContestDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('5 participants')).toBeInTheDocument();
            expect(screen.getByText('1 problem')).toBeInTheDocument();
            expect(screen.getByText('Your progress')).toBeInTheDocument();
            expect(screen.getByText('1 / 1 solved')).toBeInTheDocument();
            expect(screen.getByText('100 points')).toBeInTheDocument();
            expect(screen.getByText('Continue Solving')).toBeInTheDocument();
        });

        // The thin solved-progress bar reflects solved/total (1 of 1 here).
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '1');
        expect(bar).toHaveAttribute('aria-valuenow', '1');
        expect(bar).toHaveAttribute(
            'aria-label',
            'Problems solved: 1 of 1'
        );
    });

    it('offers Start Solving when nothing is solved yet', async () => {
        const mockContest = {
            id: 1, title: 'Test Contest', status: 'running' as const,
            description: null,
            problems: [
                { id: 'P1', title: 'Problem 1', author: null },
                { id: 'P2', title: 'Problem 2', author: null },
            ],
            is_participant: true,
            start_time: '2026-01-01T00:00:00Z',
            end_time: '2026-01-02T00:00:00Z',
            participant_count: '5'
        };
        jest.mocked(contestService.getById).mockResolvedValue(mockContest as never);
        jest.mocked(contestService.getProblems).mockResolvedValue([
            { id: 'P1', title: 'Problem 1', author: null, best_score: 0, submission_count: '0' },
            { id: 'P2', title: 'Problem 2', author: null, best_score: null, submission_count: null },
        ] as never);

        render(<BrowserRouter><ContestDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('0 / 2 solved')).toBeInTheDocument();
            expect(screen.getByText('0 points')).toBeInTheDocument();
            expect(screen.getByText('Start Solving')).toBeInTheDocument();
        });

        // Zero solved still renders the bar, just empty (0 of 2).
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuemax', '2');
        expect(bar).toHaveAttribute('aria-valuenow', '0');
    });

    it('shows error if fetch fails', async () => {
        jest.mocked(contestService.getById).mockRejectedValueOnce(new Error('Fetch failed'));

        render(<BrowserRouter><ContestDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to load contest data/i)).toBeInTheDocument();
        });
    });

    describe('top-right timing line', () => {
        const contestWith = (overrides: Record<string, unknown>) => ({
            id: 1, title: 'Test Contest', description: null,
            problems: [{ id: 'P1', title: 'Problem 1', author: null }],
            is_participant: true,
            start_time: '2026-01-01T00:00:00Z',
            end_time: '2026-01-02T00:00:00Z',
            participant_count: '5',
            ...overrides,
        });
        const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

        it('says final submissions are being judged while finishing, never "Soon remaining"', async () => {
            jest.mocked(contestService.getById).mockResolvedValue(contestWith({ status: 'finishing' }) as never);

            render(<BrowserRouter><ContestDetail /></BrowserRouter>);

            expect(await screen.findByText('Judging final submissions')).toBeInTheDocument();
            expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/soon/i)).not.toBeInTheDocument();
        });

        it('shows the remaining time while running', async () => {
            jest.mocked(contestService.getById).mockResolvedValue(
                contestWith({ status: 'running', end_time: hoursFromNow(2.5) }) as never
            );

            render(<BrowserRouter><ContestDetail /></BrowserRouter>);

            expect(await screen.findByText(/^2h (29|30)m remaining$/)).toBeInTheDocument();
        });

        it('says the contest is ending once a running contest is past its end time', async () => {
            jest.mocked(contestService.getById).mockResolvedValue(contestWith({ status: 'running' }) as never);

            render(<BrowserRouter><ContestDetail /></BrowserRouter>);

            expect(await screen.findByText('Ending now')).toBeInTheDocument();
            expect(screen.queryByText(/soon remaining/i)).not.toBeInTheDocument();
        });

        it('says the contest is starting once a scheduled contest is past its start time', async () => {
            jest.mocked(contestService.getById).mockResolvedValue(contestWith({ status: 'scheduled' }) as never);

            render(<BrowserRouter><ContestDetail /></BrowserRouter>);

            expect(await screen.findByText('Starting now')).toBeInTheDocument();
        });
    });
});
