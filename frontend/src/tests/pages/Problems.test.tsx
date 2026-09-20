import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Problems from '../../pages/problem/Problems';
import problemService from '../../services/problemService';

jest.mock('../../services/problemService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Problems...</div>);

const categorizedProblems = [
    { id: 'dp-1', title: 'Knapsack', author: null, categories: ['Dynamic Programming'], best_score: 100 },
    { id: 'dp-2', title: 'LIS', author: null, categories: ['Dynamic Programming', 'Data Structures'], best_score: 50 },
    { id: 'gr-1', title: 'Greedy Slots', author: null, categories: ['Greedy'], best_score: null },
    { id: 'pl-1', title: 'Plain Problem', author: null, categories: [], best_score: null },
];

describe('Problems Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders loading state initially', () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><Problems /></BrowserRouter>);
        expect(screen.getByText(/loading problems\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays problems after fetching', async () => {
        const mockProblems = [
            { id: '1', title: 'Problem 1', author: null, difficulty: 'easy', time_limit_ms: 1000, memory_limit_mb: 256, best_score: 100 }
        ];
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(mockProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
        });
    });

    it('displays error if fetch fails', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockRejectedValueOnce(new Error('Fetch failed'));

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch problems/i)).toBeInTheDocument();
        });
    });

    it('shows a category tab per category with counts and an Uncategorized bucket', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /All 4/ })).toBeInTheDocument();
        });
        expect(screen.getByRole('tab', { name: /Dynamic Programming 2/ })).toBeInTheDocument();
        // A problem carrying two categories counts toward both tabs.
        expect(screen.getByRole('tab', { name: /Data Structures 1/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Greedy 1/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Uncategorized 1/ })).toBeInTheDocument();
    });

    it('filters the list to the selected category', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Knapsack')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('tab', { name: /Greedy/ }));

        expect(screen.queryByText('Knapsack')).not.toBeInTheDocument();
        expect(screen.getByText('Greedy Slots')).toBeInTheDocument();
    });

    it('shows a problem in every one of its category tabs', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('LIS')).toBeInTheDocument();
        });

        // LIS carries both categories, so both tabs include it.
        fireEvent.click(screen.getByRole('tab', { name: /^Dynamic Programming/ }));
        expect(screen.getByText('LIS')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /^Data Structures/ }));
        expect(screen.getByText('LIS')).toBeInTheDocument();
    });

    it('filters the list by search text across title and id', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Knapsack')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'lis' } });

        expect(screen.queryByText('Knapsack')).not.toBeInTheDocument();
        expect(screen.getByText('LIS')).toBeInTheDocument();
    });
});
