import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ContestCard from '../../features/contest/ContestCard';

// Mock CSS modules
jest.mock('../../features/contest/ContestCard.module.css', () => new Proxy({}, {
    get: (target, prop) => prop
}));

jest.mock('../../components/shared/StatusBadge', () => {
    return function MockStatusBadge({ status }) {
        return <span data-testid="status-badge">{status}</span>;
    };
});

jest.mock('../../utils/formatters', () => ({
    formatDateTime: jest.fn((date) => `Formatted: ${date}`)
}));

const mockContest = {
    id: 1,
    title: 'Spring Contest',
    description: 'A fun contest',
    status: 'running',
    start_time: '2026-03-01T10:00:00Z',
    end_time: '2026-03-10T10:00:00Z',
    participant_count: 50,
    problem_count: 5,
    is_participant: false
};

const mockUser = { username: 'testuser', role: 'user' };

describe('ContestCard', () => {
    const mockOnJoin = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders contest title and description', () => {
        render(
            <BrowserRouter>
                <ContestCard contest={mockContest} user={mockUser} onJoin={mockOnJoin} />
            </BrowserRouter>
        );

        expect(screen.getByText('Spring Contest')).toBeInTheDocument();
        expect(screen.getByText('A fun contest')).toBeInTheDocument();
    });

    it('renders status badge', () => {
        render(
            <BrowserRouter>
                <ContestCard contest={mockContest} user={mockUser} onJoin={mockOnJoin} />
            </BrowserRouter>
        );

        expect(screen.getByTestId('status-badge')).toHaveTextContent('running');
    });

    it('renders participant and problem counts', () => {
        render(
            <BrowserRouter>
                <ContestCard contest={mockContest} user={mockUser} onJoin={mockOnJoin} />
            </BrowserRouter>
        );

        expect(screen.getByText(/Participants: 50/)).toBeInTheDocument();
        expect(screen.getByText(/Problems: 5/)).toBeInTheDocument();
    });

    it('shows Join button for joinable contests when not participant', () => {
        render(
            <BrowserRouter>
                <ContestCard contest={mockContest} user={mockUser} onJoin={mockOnJoin} />
            </BrowserRouter>
        );

        const joinBtn = screen.getByText('Join Contest');
        expect(joinBtn).toBeInTheDocument();

        fireEvent.click(joinBtn);
        expect(mockOnJoin).toHaveBeenCalledWith(1);
    });

    it('shows Enter Contest for running + participant', () => {
        const participantContest = { ...mockContest, is_participant: true };

        render(
            <BrowserRouter>
                <ContestCard contest={participantContest} user={mockUser} onJoin={mockOnJoin} />
            </BrowserRouter>
        );

        expect(screen.getByText('Enter Contest')).toBeInTheDocument();
    });

    it('shows View Results for finished contests', () => {
        const finishedContest = { ...mockContest, status: 'finished', end_time: '2020-01-01T00:00:00Z' };

        render(
            <BrowserRouter>
                <ContestCard contest={finishedContest} user={mockUser} onJoin={mockOnJoin} />
            </BrowserRouter>
        );

        expect(screen.getByText('View Results')).toBeInTheDocument();
    });
});
