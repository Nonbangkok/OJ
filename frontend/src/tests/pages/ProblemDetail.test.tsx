import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ProblemDetail from '../../pages/problem/ProblemDetail';
import ProblemCard from '../../features/problem/ProblemCard';
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

    it('places the rated chip beside the ID and reveals categories only on request', async () => {
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
        const chip = screen.getByTestId('problem-difficulty');
        const show = screen.getByRole('button', { name: 'Show categories' });
        const author = screen.getByText('Author: Ada');
        expect(chip).toHaveTextContent('2100');
        expect(chip).toHaveAttribute('data-band', '3');
        expect(chip).toHaveAttribute('title', 'Difficulty 2100');
        expect(heading.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(id.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(chip.compareDocumentPosition(show) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(show.compareDocumentPosition(author) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(show).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Graph')).not.toBeInTheDocument();
        expect(screen.queryByText('Math')).not.toBeInTheDocument();

        fireEvent.click(show);
        const hide = screen.getByRole('button', { name: 'Hide categories' });
        expect(hide).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Graph')).toBeInTheDocument();
        expect(screen.getByText('Math')).toBeInTheDocument();
        fireEvent.click(hide);
        expect(screen.getByRole('button', { name: 'Show categories' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Graph')).not.toBeInTheDocument();
    });

    it('omits difficulty and category controls for an unrated uncategorized problem', async () => {
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

    it('uses the same chip, badge, and reveal-control styles as ProblemCard', async () => {
        const metadata = {
            id: '1', title: 'Shared Metadata', author: null,
            difficulty: 1500, categories: ['Graph'], time_limit_ms: 1000, memory_limit_mb: 256,
        };
        jest.mocked(problemService.getDetails).mockResolvedValueOnce(metadata);
        jest.mocked(problemService.getAllWithStats).mockResolvedValueOnce([]);

        const detail = render(<BrowserRouter><ProblemDetail /></BrowserRouter>);
        await screen.findByRole('heading', { name: 'Shared Metadata' });
        const detailChip = screen.getByTestId('problem-difficulty');
        const detailCategoryRow = screen.getByTestId('problem-categories');
        const detailToggle = screen.getByRole('button', { name: 'Show categories' });
        fireEvent.click(detailToggle);
        const detailBadge = screen.getByText('Graph');

        const card = render(<BrowserRouter><ProblemCard problem={metadata} /></BrowserRouter>);
        const cardChip = within(card.container).getByTestId('problem-difficulty');
        const cardToggle = within(card.container).getByRole('button', { name: 'Show categories' });
        fireEvent.click(cardToggle);
        const cardBadge = within(card.container).getByText('Graph');

        expect(detailChip.className).toBeTruthy();
        expect(detailChip.className).toBe(cardChip.className);
        expect(detailBadge.className).toBe(cardBadge.className);
        expect(detailToggle.className).toBe(cardToggle.className);
        expect(detailCategoryRow.className).toBe(cardChip.parentElement?.className);
        detail.unmount();
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
