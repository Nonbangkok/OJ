import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestProblems from '../../pages/contest/ContestProblems';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Problems...</div>);
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ contestId: 'contest-1' }),
    useNavigate: () => jest.fn(),
}));

describe('ContestProblems Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(contestService.getById).mockResolvedValue({
            id: 1,
            title: 'Contest 1',
            description: null,
            start_time: '2026-01-01T00:00:00Z',
            end_time: '2026-01-01T01:00:00Z',
            status: 'running',
            is_participant: true
        });
        jest.mocked(contestService.getProblems).mockResolvedValue([]);
    });

    it('displays loading state', () => {
        jest.mocked(contestService.getById).mockReturnValue(new Promise(() => { }));

        render(
            <BrowserRouter>
                <ContestProblems />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading problems\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays contest problems on success', async () => {
        const mockProblems = [{ id: 'P1', title: 'Problem 1', author: null, best_score: 0 }];
        jest.mocked(contestService.getProblems).mockResolvedValue(mockProblems);

        render(
            <BrowserRouter>
                <ContestProblems />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Contest Problems')).toBeInTheDocument();
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
        });
    });
});
