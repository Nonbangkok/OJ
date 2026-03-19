import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Scoreboard from '../../pages/scoreboard/Scoreboard';
import scoreboardService from '../../services/scoreboardService';

jest.mock('../../services/scoreboardService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Scoreboard...</div>);

describe('Scoreboard Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders loading state initially', () => {
        scoreboardService.getGlobal.mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><Scoreboard /></BrowserRouter>);
        expect(screen.getByText(/loading scoreboard\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays scoreboard data with rank emojis on success', async () => {
        const mockScoreboard = [
            { username: 'topuser', total_score: 100, problems_solved: 5 },
            { username: 'seconduser', total_score: 80, problems_solved: 4 },
            { username: 'thirduser', total_score: 60, problems_solved: 3 },
            { username: 'regularuser', total_score: 40, problems_solved: 2 }
        ];
        scoreboardService.getGlobal.mockResolvedValueOnce(mockScoreboard);

        render(<BrowserRouter><Scoreboard /></BrowserRouter>);

        await waitFor(() => {
            // Check for names
            expect(screen.getByText(/topuser/)).toBeInTheDocument();
            expect(screen.getByText(/seconduser/)).toBeInTheDocument();
            expect(screen.getByText(/thirduser/)).toBeInTheDocument();

            // Check for emojis (🥇, 🥈, 🥉)
            expect(screen.getByText(/🥇 topuser/)).toBeInTheDocument();
            expect(screen.getByText(/🥈 seconduser/)).toBeInTheDocument();
            expect(screen.getByText(/🥉 thirduser/)).toBeInTheDocument();
        });
    });

    it('handles fetch error gracefully', async () => {
        scoreboardService.getGlobal.mockRejectedValueOnce(new Error('Fetch error'));

        render(<BrowserRouter><Scoreboard /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch scoreboard/i)).toBeInTheDocument();
        });
    });
});
