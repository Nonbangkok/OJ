import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestProblems from '../../pages/ContestProblems';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ contestId: 'contest-1' }),
    useNavigate: () => jest.fn(),
}));

describe('ContestProblems Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        contestService.getById.mockResolvedValue({ id: 'contest-1', status: 'running', is_participant: true });
        contestService.getProblems.mockResolvedValue([]);
    });

    it('displays loading state', () => {
        contestService.getById.mockReturnValue(new Promise(() => {}));

        render(
            <BrowserRouter>
                <ContestProblems />
            </BrowserRouter>
        );

        expect(screen.getByText(/loading problems/i)).toBeInTheDocument();
    });

    it('displays contest problems on success', async () => {
        const mockProblems = [{ id: 'P1', title: 'Problem 1', best_score: 0 }];
        contestService.getProblems.mockResolvedValue(mockProblems);

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
