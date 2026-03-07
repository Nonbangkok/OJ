import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestDetail from '../../pages/contest/ContestDetail';
import contestService from '../../services/contestService';

jest.mock('../../services/contestService');
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ contestId: '1' }),
    useNavigate: () => jest.fn()
}));

jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { username: 'testuser' } })
}));

describe('ContestDetail Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders loading state initially', () => {
        contestService.getById.mockReturnValue(new Promise(() => { }));
        render(<BrowserRouter><ContestDetail /></BrowserRouter>);
        expect(screen.getByText(/loading contest data/i)).toBeInTheDocument();
    });

    it('displays contest details successfully', async () => {
        const mockContest = {
            id: '1', title: 'Test Contest', status: 'running',
            problems: [{ id: 'P1', title: 'Problem 1' }],
            is_participant: true,
            start_time: '2026-01-01T00:00:00Z',
            end_time: '2026-01-02T00:00:00Z',
            participant_count: 5
        };
        contestService.getById.mockResolvedValueOnce(mockContest);

        render(<BrowserRouter><ContestDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Test Contest')).toBeInTheDocument();
        });
    });

    it('shows error if fetch fails', async () => {
        contestService.getById.mockRejectedValueOnce(new Error('Fetch failed'));

        render(<BrowserRouter><ContestDetail /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to load contest data/i)).toBeInTheDocument();
        });
    });
});
