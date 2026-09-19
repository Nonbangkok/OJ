import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SubmissionsTab from '../features/admin/analysis/SubmissionsTab';
import * as analyticsService from '../services/analyticsService';

jest.mock('../services/analyticsService');

const mockFetchSubmissions = analyticsService.fetchAnalyticsSubmissions as jest.MockedFunction<typeof analyticsService.fetchAnalyticsSubmissions>;
const mockFetchProblems = analyticsService.fetchAnalyticsProblems as jest.MockedFunction<typeof analyticsService.fetchAnalyticsProblems>;
const mockFetchUsers = analyticsService.fetchAnalyticsUsers as jest.MockedFunction<typeof analyticsService.fetchAnalyticsUsers>;

const mockSubmission = {
    id: 42,
    source: 'main' as const,
    problemId: 'aplusb',
    problemTitle: 'A Plus B',
    userId: 2,
    username: 'bob',
    verdict: 'Accepted',
    score: 100,
    language: 'cpp',
    timeMs: 12,
    memoryKb: 4096,
    submittedAt: '2026-09-19T05:00:00+00:00',
};

describe('SubmissionsTab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchProblems.mockResolvedValue({
            problems: [{ problemId: 'aplusb', title: 'A Plus B', category: 'math', submissions: 30, accepted: 20, acRate: 0.667, solvers: 8 }],
        });
        mockFetchUsers.mockResolvedValue({
            users: [{ userId: 2, username: 'bob', role: 'user', submissions: 20, solved: 4, acRate: 0.5, lastActive: null }],
        });
    });

    it('renders the submissions table unfiltered on load', async () => {
        mockFetchSubmissions.mockResolvedValueOnce({ submissions: [mockSubmission] });

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        const table = await waitFor(() => {
            const el = document.querySelector('table');
            if (!el) throw new Error('table not rendered');
            return el;
        });
        expect(within(table).getByText('bob')).toBeInTheDocument();
        expect(within(table).getByText('A Plus B')).toBeInTheDocument();
        expect(within(table).getByText('Accepted')).toBeInTheDocument();
        expect(mockFetchSubmissions).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
    });

    it('fetches with the problem filter when one is selected', async () => {
        mockFetchSubmissions.mockResolvedValue({ submissions: [mockSubmission] });

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Filter by problem'), { target: { value: 'aplusb' } });

        await waitFor(() => expect(mockFetchSubmissions).toHaveBeenCalledWith(
            expect.objectContaining({ problemId: 'aplusb' }),
        ));
    });

    it('fetches with the user filter when one is selected', async () => {
        mockFetchSubmissions.mockResolvedValue({ submissions: [mockSubmission] });

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Filter by user'), { target: { value: '2' } });

        await waitFor(() => expect(mockFetchSubmissions).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 2 }),
        ));
    });

    it('calls onSelectUser and onSelectProblem from a row', async () => {
        mockFetchSubmissions.mockResolvedValue({ submissions: [mockSubmission] });
        const onSelectUser = jest.fn();
        const onSelectProblem = jest.fn();

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={onSelectUser} onSelectProblem={onSelectProblem} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'User' }));
        expect(onSelectUser).toHaveBeenCalledWith(2);

        fireEvent.click(screen.getByRole('button', { name: 'Problem' }));
        expect(onSelectProblem).toHaveBeenCalledWith('aplusb');
    });

    it('renders an error when the fetch fails', async () => {
        mockFetchSubmissions.mockRejectedValueOnce(new Error('boom'));

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
    });
});
