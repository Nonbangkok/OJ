import { render, screen } from '@testing-library/react';
import ScoreboardTable from '../../features/scoreboard/ScoreboardTable';

// Mock CSS modules
jest.mock('../../components/styles/Table.module.css', () => ({
    'table-container': 'table-container',
    table: 'table'
}));
jest.mock('../../features/scoreboard/ScoreboardTable.module.css', () => ({
    'rank-1': 'rank-1',
    'rank-2': 'rank-2',
    'rank-3': 'rank-3'
}));

const mockScoreboard = [
    { username: 'alice', problems_solved: 10, total_score: 1000 },
    { username: 'bob', problems_solved: 8, total_score: 800 },
    { username: 'charlie', problems_solved: 6, total_score: 600 },
    { username: 'dave', problems_solved: 4, total_score: 400 }
];

describe('ScoreboardTable', () => {
    it('renders table headers', () => {
        render(<ScoreboardTable scoreboard={mockScoreboard} />);

        expect(screen.getByText('Rank')).toBeInTheDocument();
        expect(screen.getByText('User')).toBeInTheDocument();
        expect(screen.getByText('Problems Solved')).toBeInTheDocument();
        expect(screen.getByText('Total Score')).toBeInTheDocument();
    });

    it('renders all users', () => {
        render(<ScoreboardTable scoreboard={mockScoreboard} />);

        expect(screen.getByText(/alice/)).toBeInTheDocument();
        expect(screen.getByText(/bob/)).toBeInTheDocument();
        expect(screen.getByText(/charlie/)).toBeInTheDocument();
        expect(screen.getByText(/dave/)).toBeInTheDocument();
    });

    it('renders medal emojis for top 3', () => {
        render(<ScoreboardTable scoreboard={mockScoreboard} />);

        expect(screen.getByText(/🥇/)).toBeInTheDocument();
        expect(screen.getByText(/🥈/)).toBeInTheDocument();
        expect(screen.getByText(/🥉/)).toBeInTheDocument();
    });

    it('renders scores correctly', () => {
        render(<ScoreboardTable scoreboard={mockScoreboard} />);

        expect(screen.getByText('1000')).toBeInTheDocument();
        expect(screen.getByText('800')).toBeInTheDocument();
    });

    it('renders empty scoreboard', () => {
        render(<ScoreboardTable scoreboard={[]} />);

        expect(screen.getByText('Rank')).toBeInTheDocument();
        expect(screen.queryByText(/alice/)).not.toBeInTheDocument();
    });
});
