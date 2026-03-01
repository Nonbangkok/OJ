import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Scoreboard from '../../pages/Scoreboard';
import api from '../../services/api';

jest.mock('../../services/api');

describe('Scoreboard Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders loading state initially', () => {
        api.get.mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><Scoreboard /></BrowserRouter>);
        expect(screen.getByText(/loading scoreboard/i)).toBeInTheDocument();
    });

    it('displays scoreboard data on success', async () => {
        const mockScoreboard = [
            { username: 'testuser', total_score: 100, problems_solved: 1 }
        ];
        api.get.mockResolvedValueOnce({ data: mockScoreboard });

        render(<BrowserRouter><Scoreboard /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('testuser')).toBeInTheDocument();
            expect(screen.getByText('100')).toBeInTheDocument();
        });
    });

    it('handles fetch error gracefully', async () => {
        api.get.mockRejectedValueOnce(new Error('Fetch error'));

        render(<BrowserRouter><Scoreboard /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch scoreboard/i)).toBeInTheDocument();
        });
    });
});
