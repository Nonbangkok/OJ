import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ProblemCard from '../../features/problem/ProblemCard';
import type { ProblemSummary } from '../../types';

// Mock CSS modules
jest.mock('../../features/problem/ProblemCard.module.css', () => new Proxy({}, {
    get: (target, prop) => prop
}));

jest.mock('../../utils/formatters', () => ({
    formatTimeAgo: jest.fn(() => '5 minutes ago'),
    formatDateAbsolute: jest.fn(() => 'Mar 7, 2026'),
    generateResultString: jest.fn(() => 'PPPP')
}));

const mockProblem: ProblemSummary = {
    id: 'prob-1',
    title: 'Two Sum',
    author: null,
    submission_count: '3',
    latest_submission_at: '2026-03-07T12:00:00Z',
    best_score: 75,
    best_submission_status: 'Partial',
    best_submission_results: [{ status: 'Accepted' }, { status: 'Accepted' }]
};

const mockProblemNoSubmission: ProblemSummary = {
    id: 'prob-2',
    title: 'Hello World',
    author: null,
    submission_count: '0'
};

describe('ProblemCard', () => {
    it('renders problem title and id', () => {
        render(
            <BrowserRouter>
                <ProblemCard problem={mockProblem} />
            </BrowserRouter>
        );

        expect(screen.getByText('Two Sum')).toBeInTheDocument();
        expect(screen.getByText('prob-1')).toBeInTheDocument();
    });

    it('shows submission info when submitted', () => {
        render(
            <BrowserRouter>
                <ProblemCard problem={mockProblem} />
            </BrowserRouter>
        );

        expect(screen.getByText(/3 tries/)).toBeInTheDocument();
        expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('shows New button when not submitted', () => {
        render(
            <BrowserRouter>
                <ProblemCard problem={mockProblemNoSubmission} />
            </BrowserRouter>
        );

        expect(screen.getByText('New')).toBeInTheDocument();
    });

    it('generates correct link for non-contest problems', () => {
        render(
            <BrowserRouter>
                <ProblemCard problem={mockProblem} />
            </BrowserRouter>
        );

        const link = screen.getByText('Edit').closest('a');
        expect(link).toHaveAttribute('href', '/problems/prob-1');
    });

    it('generates correct link for contest problems', () => {
        render(
            <BrowserRouter>
                <ProblemCard problem={mockProblem} contestId="contest-123" />
            </BrowserRouter>
        );

        const link = screen.getByText('Edit').closest('a');
        expect(link).toHaveAttribute('href', '/contests/contest-123/problems/prob-1');
    });
});
