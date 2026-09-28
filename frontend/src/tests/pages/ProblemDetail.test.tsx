import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ProblemDetail from '../../pages/problem/ProblemDetail';
import problemService from '../../services/problemService';

jest.mock('../../services/problemService');
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ problemId: '1' })
}));

describe('ProblemDetail Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('displays problem details successfully', async () => {
        const mockProblem = {
            id: '1', title: 'Test Problem', description: 'Test Desc', difficulty: 'easy',
            author: null,
            time_limit_ms: 1000, memory_limit_mb: 256
        };
        const mockStats = [{ id: '1', title: 'Test Problem', author: null, time_limit_ms: 1000, memory_limit_mb: 256, best_score: 0 }];
        (jest.mocked(problemService.getDetails) as jest.Mock).mockResolvedValueOnce(mockProblem);
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(mockStats);

        render(<BrowserRouter><ProblemDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Test Problem')).toBeInTheDocument();
            expect(screen.getByText(/time limit/i)).toBeInTheDocument();
            expect(screen.getByText(/1000/)).toBeInTheDocument();
        });
    });

    it('keeps difficulty and categories off the Problem Detail sidebar', async () => {
        const detail = {
            id: '1', title: 'Test Problem', author: 'Ada',
            difficulty: 2100, categories: ['Graph', 'Math'],
            time_limit_ms: 1000, memory_limit_mb: 256,
        };
        jest.mocked(problemService.getDetails).mockResolvedValueOnce(detail);
        jest.mocked(problemService.getAllWithStats).mockResolvedValueOnce([]);

        render(<BrowserRouter><ProblemDetail /></BrowserRouter>);

        const heading = await screen.findByRole('heading', { name: 'Test Problem' });
        const id = screen.getByText('1');
        const author = screen.getByText('Author: Ada');
        expect(heading.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(id.compareDocumentPosition(author) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByTestId('problem-difficulty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('problem-categories')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /categories/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Graph')).not.toBeInTheDocument();
        expect(screen.queryByText('Math')).not.toBeInTheDocument();
        expect(screen.getByText('Time Limit: 1000 ms')).toBeInTheDocument();
        expect(screen.getByText('Memory Limit: 256 MB')).toBeInTheDocument();
    });

    it('keeps the simple sidebar when an unrated problem has no categories', async () => {
        jest.mocked(problemService.getDetails).mockResolvedValueOnce({
            id: '1', title: 'Unrated Problem', author: null,
            difficulty: null, categories: [], time_limit_ms: 1000, memory_limit_mb: 256,
        });
        jest.mocked(problemService.getAllWithStats).mockResolvedValueOnce([]);

        render(<BrowserRouter><ProblemDetail /></BrowserRouter>);

        await screen.findByRole('heading', { name: 'Unrated Problem' });
        expect(screen.queryByTestId('problem-difficulty')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /categories/i })).not.toBeInTheDocument();
        expect(screen.queryByTestId('problem-categories')).not.toBeInTheDocument();
        expect(screen.getByText('Time Limit: 1000 ms')).toBeInTheDocument();
    });

    it('shows a back control that navigates back to the list', async () => {
        const mockProblem = {
            id: '1', title: 'Test Problem', author: null,
            time_limit_ms: 1000, memory_limit_mb: 256
        };
        const mockStats = [{ id: '1', title: 'Test Problem', author: null, time_limit_ms: 1000, memory_limit_mb: 256, best_score: 0 }];
        (jest.mocked(problemService.getDetails) as jest.Mock).mockResolvedValueOnce(mockProblem);
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(mockStats);

        render(<BrowserRouter><ProblemDetail /></BrowserRouter>);

        const back = await screen.findByRole('button', { name: 'Back to problem list' });
        expect(back).toBeInTheDocument();
    });

    it('displays error if problem fetch fails', async () => {
        (jest.mocked(problemService.getDetails) as jest.Mock).mockRejectedValueOnce(new Error('Fetch failed'));

        render(<BrowserRouter><ProblemDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch problem/i)).toBeInTheDocument();
        });
    });
});
