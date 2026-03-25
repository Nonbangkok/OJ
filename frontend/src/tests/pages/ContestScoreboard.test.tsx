import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestScoreboard from '../../pages/contest/ContestScoreboard';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Contest Rankings...</div>);
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ contestId: 'contest-1' }),
}));

describe('ContestScoreboard Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('displays loading state', () => {
        jest.mocked(contestService.getById).mockReturnValue(new Promise(() => { }));
        jest.mocked(contestService.getScoreboard).mockReturnValue(new Promise(() => { }));

        render(
            <BrowserRouter>
                <ContestScoreboard />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading contest rankings\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays contest scoreboard on success', async () => {
        const mockContest = {
            id: 1,
            title: 'Contest 1',
            description: null,
            start_time: '2026-01-01T00:00:00Z',
            end_time: '2026-01-01T01:00:00Z',
            status: 'running' as const
        };
        const mockScoreboardData = {
            scoreboard: [{ user_id: 1, username: 'user1', total_score: 100, detailed_scores: {}, last_score_improvement_time: null }],
            problems: [{ id: 'P1', title: 'Problem 1', author: null, problem_id: 'P1' }],
        };

        jest.mocked(contestService.getById).mockResolvedValueOnce(mockContest);
        jest.mocked(contestService.getScoreboard).mockResolvedValueOnce(mockScoreboardData);

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
        jest.mocked(contestService.getById).mockRejectedValueOnce({ response: { status: 404 } });
        jest.mocked(contestService.getScoreboard).mockResolvedValueOnce({ scoreboard: [], problems: [] });

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
