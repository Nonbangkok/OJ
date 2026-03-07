import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestScoreboard from '../../pages/contest/ContestScoreboard';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ contestId: 'contest-1' }),
}));

describe('ContestScoreboard Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('displays loading state', () => {
        contestService.getById.mockReturnValue(new Promise(() => { }));
        contestService.getScoreboard.mockReturnValue(new Promise(() => { }));

        render(
            <BrowserRouter>
                <ContestScoreboard />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading contest rankings/i)).toBeInTheDocument();
    });

    it('displays contest scoreboard on success', async () => {
        const mockContest = { id: 'contest-1', status: 'running' };
        const mockScoreboardData = {
            scoreboard: [{ user_id: 1, username: 'user1', total_score: 100, detailed_scores: {} }],
            problems: [{ problem_id: 'P1' }],
        };

        contestService.getById.mockResolvedValueOnce(mockContest);
        contestService.getScoreboard.mockResolvedValueOnce(mockScoreboardData);

        render(
            <BrowserRouter>
                <ContestScoreboard />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Contest Scoreboard')).toBeInTheDocument();
            expect(screen.getByText('user1')).toBeInTheDocument();
            expect(screen.getByText('100')).toBeInTheDocument();
        });

        expect(contestService.getById).toHaveBeenCalledWith('contest-1');
        expect(contestService.getScoreboard).toHaveBeenCalledWith('contest-1');
    });

    it('displays error when contest not found', async () => {
        contestService.getById.mockRejectedValueOnce({ response: { status: 404 } });
        contestService.getScoreboard.mockResolvedValueOnce({ scoreboard: [], problems: [] });

        render(
            <BrowserRouter>
                <ContestScoreboard />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText(/contest not found/i)).toBeInTheDocument();
        });
    });
});
