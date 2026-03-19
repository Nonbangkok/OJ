import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestSubmissions from '../../pages/contest/ContestSubmissions';
import contestService from '../../services/contestService';
import submissionService from '../../services/submissionService';
import authService from '../../services/authService';

jest.mock('../../services/contestService');
jest.mock('../../services/submissionService');
jest.mock('../../services/authService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Contest Submissions...</div>);
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ contestId: 'contest-1' }),
}));
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { username: 'testuser', role: 'user' } }),
}));

describe('ContestSubmissions Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        contestService.getById.mockResolvedValue({ id: 'contest-1', status: 'running', is_participant: true });
        submissionService.getAll.mockResolvedValue([]);
        submissionService.searchProblems.mockResolvedValue([]);
        submissionService.searchUsers.mockResolvedValue([]);
        authService.checkLogin.mockResolvedValue({ isAuthenticated: true });
    });

    it('displays loading state', () => {
        contestService.getById.mockReturnValue(new Promise(() => { }));

        render(
            <BrowserRouter>
                <ContestSubmissions />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading contest submissions\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays contest submissions header and empty state', async () => {
        render(
            <BrowserRouter>
                <ContestSubmissions />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Contest Submissions')).toBeInTheDocument();
            expect(screen.getByText(/no submissions yet/i)).toBeInTheDocument();
        });
    });

    it('displays submissions on success', async () => {
        const mockSubmissions = [
            {
                id: 1,
                problem_id: 'P1',
                problem_title: 'Problem 1',
                username: 'user1',
                overall_status: 'Accepted',
                score: 100,
                language: 'python',
                submitted_at: '2026-01-01T00:00:00Z',
            },
        ];
        submissionService.getAll.mockResolvedValue(mockSubmissions);

        render(
            <BrowserRouter>
                <ContestSubmissions />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
            expect(screen.getByText('Accepted')).toBeInTheDocument();
        });
    });
});

