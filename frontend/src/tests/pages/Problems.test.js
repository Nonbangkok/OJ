import { render, screen, waitFor } from '@testing-library/react';
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

describe('Problems Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders loading state initially', () => {
        problemService.getAllWithStats.mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><Problems /></BrowserRouter>);
        expect(screen.getByText(/loading problems\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays problems after fetching', async () => {
        const mockProblems = [
            { id: '1', title: 'Problem 1', difficulty: 'easy', best_score: 100 }
        ];
        problemService.getAllWithStats.mockResolvedValueOnce(mockProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
        });
    });

    it('displays error if fetch fails', async () => {
        problemService.getAllWithStats.mockRejectedValueOnce(new Error('Fetch failed'));

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch problems/i)).toBeInTheDocument();
        });
    });
});
