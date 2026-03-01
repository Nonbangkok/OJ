import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Contests from '../../pages/Contests';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { username: 'testuser' } })
}));

describe('Contests Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('displays loading state', () => {
        contestService.getAll.mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><Contests /></BrowserRouter>);
        expect(screen.getByText(/loading contests/i)).toBeInTheDocument();
    });

    it('displays contests on success', async () => {
        const mockContests = [
            { id: '1', title: 'Monthly Contest', status: 'running', participant_count: 5 }
        ];
        contestService.getAll.mockResolvedValueOnce(mockContests);

        render(<BrowserRouter><Contests /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Monthly Contest')).toBeInTheDocument();
        });
    });

    it('displays fallback message when no contests', async () => {
        contestService.getAll.mockResolvedValueOnce([]);

        render(<BrowserRouter><Contests /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/no contests available at the moment/i)).toBeInTheDocument();
        });
    });

    it('handles fetch error gracefully', async () => {
        contestService.getAll.mockRejectedValueOnce(new Error('Fetch error'));

        render(<BrowserRouter><Contests /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to load contests/i)).toBeInTheDocument();
        });
    });
});
