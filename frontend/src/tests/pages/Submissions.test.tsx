import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Submissions from '../../pages/submission/Submissions';
import submissionService from '../../services/submissionService';
import authService from '../../services/authService';

jest.mock('../../services/submissionService');
jest.mock('../../services/authService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Submissions...</div>);
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({})
}));

describe('Submissions Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(authService.checkLogin).mockResolvedValue({ isAuthenticated: false });
        jest.mocked(submissionService.searchProblems).mockResolvedValue([]);
        jest.mocked(submissionService.searchUsers).mockResolvedValue([]);
    });

    it('renders loading state initially', () => {
        jest.mocked(submissionService.getAll).mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><Submissions /></BrowserRouter>);
        expect(screen.getByText(/loading submissions\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays submissions on success', async () => {
        const mockSubmissions = [
            { id: 1, problem_id: 'P1', problem_title: 'Test Problem', username: 'user1', overall_status: 'Accepted', score: 100, language: 'python', submitted_at: '2025-01-01T00:00:00Z' }
        ];
        jest.mocked(submissionService.getAll).mockResolvedValueOnce(mockSubmissions);

        render(<BrowserRouter><Submissions /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Test Problem')).toBeInTheDocument();
            expect(screen.getByText('Accepted')).toBeInTheDocument();
        });
    });

    it('handles fetch error gracefully', async () => {
        jest.mocked(submissionService.getAll).mockRejectedValueOnce(new Error('Fetch error'));

        render(<BrowserRouter><Submissions /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch submissions/i)).toBeInTheDocument();
        });
    });
});
