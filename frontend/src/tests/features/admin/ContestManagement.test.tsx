import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ContestManagement from '../../../features/admin/contests/ContestManagement';
import adminService from '../../../services/adminService';
import { BrowserRouter } from 'react-router-dom';

// Mock services
jest.mock('../../../services/adminService');

// Mock ThemeContext to prevent useTheme errors from child components
jest.mock('../../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control what text appears during loading state
jest.mock('../../../components/shared/LoadingPage', () => () => <div>Loading Contests...</div>);

const mockContests = [
    {
        id: 1,
        title: 'Contest 1',
        description: null,
        status: 'scheduled',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-01T12:00:00Z',
        participant_count: 5,
        problem_count: 3
    },
    {
        id: 2,
        title: 'Contest 2',
        description: null,
        status: 'running',
        start_time: '2025-01-01T10:00:00Z',
        end_time: '2026-12-31T12:00:00Z',
        participant_count: 10,
        problem_count: 5
    },
    {
        id: 3,
        title: 'Contest 3',
        description: null,
        status: 'finished',
        start_time: '2024-01-01T10:00:00Z',
        end_time: '2024-01-01T12:00:00Z',
        participant_count: 20,
        problem_count: 4
    }
];

const mockCurrentUser = { id: 1, username: 'admin', role: 'admin' };

const renderContestManagement = () => {
    return render(
        <BrowserRouter>
            <ContestManagement />
        </BrowserRouter>
    );
};

describe('ContestManagement Component', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(adminService.getContests) as jest.Mock).mockResolvedValue(mockContests);
    });

    it('renders loading state initially', () => {
        (jest.mocked(adminService.getContests) as jest.Mock).mockReturnValue(new Promise(() => { }));
        renderContestManagement();
        expect(screen.getByText(/loading contests\.\.\.$/i)).toBeInTheDocument();
    });

    it('renders contest list correctly', async () => {
        renderContestManagement();

        await waitFor(() => {
            expect(screen.getByText('Contest Management')).toBeInTheDocument();
            expect(screen.getByText('Contest 1')).toBeInTheDocument();
            expect(screen.getByText('Scheduled')).toBeInTheDocument();
            expect(screen.getByText('Running')).toBeInTheDocument();
            expect(screen.getByText('Finished')).toBeInTheDocument();
        });
    });

    it('shows correct participant and problem counts', async () => {
        renderContestManagement();

        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            const c1Row = rows.find(r => r.textContent.includes('Contest 1'));
            expect(within(c1Row).getByText('5')).toBeInTheDocument(); // Participants
            expect(within(c1Row).getByText('3')).toBeInTheDocument(); // Problems
        });
    });

    it('opens ContestModal for creating new contest', async () => {
        renderContestManagement();

        await waitFor(() => screen.getByText('Create New Contest'));
        fireEvent.click(screen.getByText('Create New Contest'));

        expect(screen.getByText(/create contest/i)).toBeInTheDocument();
    });

    it('opens ContestModal for editing existing contest', async () => {
        renderContestManagement();

        await waitFor(() => screen.getByText('Contest 1'));
        const c1Row = screen.getAllByRole('row').find(r => r.textContent.includes('Contest 1'));
        fireEvent.click(within(c1Row).getByText(/edit/i));

        expect(screen.getByText(/edit contest/i)).toBeInTheDocument();
    });

    it('disables "Problems" button for finished contests', async () => {
        renderContestManagement();

        await waitFor(() => screen.getByText('Contest 3'));
        const c3Row = screen.getAllByRole('row').find(r => r.textContent.includes('Contest 3'));
        const problemsBtn = within(c3Row).getByRole('button', { name: /problems/i });
        expect(problemsBtn).toBeDisabled();
    });

    it('blocks deletion of running contests', async () => {
        renderContestManagement();

        await waitFor(() => screen.getByText('Contest 2'));
        const c2Row = screen.getAllByRole('row').find(r => r.textContent.includes('Contest 2'));
        const deleteBtn = within(c2Row).getByRole('button', { name: /delete/i });
        expect(deleteBtn).toBeDisabled();
    });

    it('handles contest deletion for non-running contests', async () => {
        (jest.mocked(adminService.deleteContest) as jest.Mock).mockResolvedValue({ message: 'Deleted' });
        renderContestManagement();

        await waitFor(() => screen.getByText('Contest 1'));
        const c1Row = screen.getAllByRole('row').find(r => r.textContent.includes('Contest 1'));
        fireEvent.click(within(c1Row).getByText(/delete/i));

        expect(screen.getByText(/are you sure you want to delete this contest/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

        await waitFor(() => {
            expect(adminService.deleteContest).toHaveBeenCalledWith(1);
        });
    });
});
