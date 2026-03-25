import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Contests from '../../pages/contest/Contests';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Contests...</div>);
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, username: 'testuser', role: 'user' }, isLoading: false, login: jest.fn(), logout: jest.fn() })
}));

describe('Contests Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('displays loading state', () => {
        jest.mocked(contestService.getAll).mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><Contests /></BrowserRouter>);
        expect(screen.getByText(/loading contests\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays contests on success', async () => {
        const mockContests = [
            {
                id: 1,
                title: 'Monthly Contest',
                description: null,
                start_time: '2026-01-01T00:00:00Z',
                end_time: '2026-01-01T01:00:00Z',
                status: 'running' as const,
                participant_count: '5'
            }
        ];
        jest.mocked(contestService.getAll).mockResolvedValueOnce(mockContests);

        render(<BrowserRouter><Contests /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Monthly Contest')).toBeInTheDocument();
        });
    });

    it('displays fallback message when no contests', async () => {
        jest.mocked(contestService.getAll).mockResolvedValueOnce([]);

        render(<BrowserRouter><Contests /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/no contests available at the moment/i)).toBeInTheDocument();
        });
    });

    it('handles fetch error gracefully', async () => {
        jest.mocked(contestService.getAll).mockRejectedValueOnce(new Error('Fetch error'));

        render(<BrowserRouter><Contests /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to load contests/i)).toBeInTheDocument();
        });
    });
});
