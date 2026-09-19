import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SubmissionsTab from '../features/admin/analysis/SubmissionsTab';
import * as analyticsService from '../services/analyticsService';
import submissionService from '../services/submissionService';

jest.mock('../services/analyticsService');
jest.mock('../services/submissionService', () => ({
    searchProblems: jest.fn(),
    searchUsers: jest.fn(),
    getById: jest.fn(),
}));

const mockFetchSubmissions = analyticsService.fetchAnalyticsSubmissions as jest.MockedFunction<typeof analyticsService.fetchAnalyticsSubmissions>;
const mockSearchProblems = submissionService.searchProblems as jest.MockedFunction<typeof submissionService.searchProblems>;
const mockSearchUsers = submissionService.searchUsers as jest.MockedFunction<typeof submissionService.searchUsers>;
const mockGetById = submissionService.getById as jest.MockedFunction<typeof submissionService.getById>;

const mockSubmission = {
    id: 42,
    source: 'main' as const,
    contestId: null,
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
        // Reset implementations here: clearAllMocks wipes factory-level
        // mockResolvedValue, leaving the hooks with undefined suggestions.
        mockSearchProblems.mockResolvedValue([
            { id: 'aplusb', title: 'A Plus B' },
        ]);
        mockSearchUsers.mockResolvedValue([
            { id: 2, username: 'bob' },
        ]);
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
        expect(table.querySelector('a[href="/profile/bob"]')).not.toBeNull();
        expect(screen.getByText('A Plus B')).toBeInTheDocument();
        expect(mockFetchSubmissions).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
    });

    it('does not render a source column', async () => {
        mockFetchSubmissions.mockResolvedValueOnce({ submissions: [mockSubmission] });

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());

        const headers = Array.from(document.querySelectorAll('th')).map((th) => th.textContent);
        expect(headers).not.toContain('Source');
    });

    it('shows problem suggestions while typing and filters on selection', async () => {
        mockFetchSubmissions.mockResolvedValue({ submissions: [mockSubmission] });

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());

        const problemInput = screen.getByLabelText('Filter by problem');
        fireEvent.change(problemInput, { target: { value: 'plus' } });

        await waitFor(() => expect(mockSearchProblems).toHaveBeenCalledWith('plus'));

        const suggestion = await waitFor(() => {
            const el = screen.getByText('aplusb — A Plus B');
            if (!el) throw new Error('suggestion not shown');
            return el;
        });
        fireEvent.click(suggestion);

        await waitFor(() => expect(mockFetchSubmissions).toHaveBeenCalledWith(
            expect.objectContaining({ problemId: 'aplusb' }),
        ));
        expect(screen.getByLabelText('Clear problem filter')).toBeInTheDocument();
    });

    it('shows user suggestions while typing and filters on selection', async () => {
        mockFetchSubmissions.mockResolvedValue({ submissions: [mockSubmission] });

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Filter by user'), { target: { value: 'bo' } });

        await waitFor(() => expect(mockSearchUsers).toHaveBeenCalledWith('bo'));

        const suggestion = await waitFor(() => {
            const items = document.querySelectorAll('ul li');
            const el = Array.from(items).find((li) => li.textContent === 'bob');
            if (!el) throw new Error('user suggestion not shown');
            return el;
        });
        fireEvent.click(suggestion);

        await waitFor(() => expect(mockFetchSubmissions).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 2 }),
        ));
    });

    it('clears the user filter when the clear button is clicked', async () => {
        mockFetchSubmissions.mockResolvedValue({ submissions: [mockSubmission] });

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('A Plus B')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Filter by user'), { target: { value: 'bo' } });
        await waitFor(() => expect(mockSearchUsers).toHaveBeenCalled());
        const suggestion = await waitFor(() => {
            const items = document.querySelectorAll('ul li');
            const el = Array.from(items).find((li) => li.textContent === 'bob');
            if (!el) throw new Error('user suggestion not shown');
            return el;
        });
        fireEvent.click(suggestion);
        await waitFor(() => expect(screen.getByLabelText('Clear user filter')).toBeInTheDocument());

        fireEvent.click(screen.getByLabelText('Clear user filter'));

        await waitFor(() => expect(mockFetchSubmissions).toHaveBeenCalledWith(
            expect.objectContaining({ userId: undefined }),
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

    it('opens the code modal when View is clicked', async () => {
        mockFetchSubmissions.mockResolvedValue({ submissions: [mockSubmission] });
        mockGetById.mockResolvedValueOnce({
            id: 42,
            code: 'int main() { return 0; }',
            problem_name: 'A Plus B',
            username: 'bob',
            overall_status: 'Accepted',
            score: 100,
            language: 'cpp',
            submitted_at: '2026-09-19T05:00:00+00:00',
        } as never);

        render(
            <BrowserRouter>
                <SubmissionsTab onSelectUser={jest.fn()} onSelectProblem={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'View' }));

        await waitFor(() => expect(mockGetById).toHaveBeenCalledWith(42, null));
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
