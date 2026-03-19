import { render, screen, waitFor } from '@testing-library/react';
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
            time_limit_ms: 1000, memory_limit_mb: 256
        };
        const mockStats = [{ id: '1', best_score: 0 }];
        problemService.getDetails.mockResolvedValueOnce(mockProblem);
        problemService.getAllWithStats.mockResolvedValueOnce(mockStats);

        render(<BrowserRouter><ProblemDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Test Problem')).toBeInTheDocument();
            expect(screen.getByText(/time limit/i)).toBeInTheDocument();
            expect(screen.getByText(/1000/)).toBeInTheDocument();
        });
    });

    it('displays error if problem fetch fails', async () => {
        problemService.getDetails.mockRejectedValueOnce(new Error('Fetch failed'));

        render(<BrowserRouter><ProblemDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch problem/i)).toBeInTheDocument();
        });
    });
});
