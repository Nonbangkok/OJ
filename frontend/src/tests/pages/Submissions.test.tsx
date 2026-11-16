import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Submissions from '../../pages/submission/Submissions';
import submissionService from '../../services/submissionService';
import { subscribeSubmissions, type SubmissionUpdatePayload } from '../../services/realtimeService';
import { useAuth } from '../../context/AuthContext';

jest.mock('../../services/submissionService');
jest.mock('../../services/realtimeService', () => ({
    ...jest.requireActual('../../services/realtimeService'),
    isRealtimeSupported: () => true,
    subscribeSubmissions: jest.fn(() => () => undefined),
}));
jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const student = { id: 7, username: 'nattapat', role: 'user' as const };
const staff = { id: 2, username: 'ta', role: 'staff' as const };
const row = (id: number, over: Record<string, unknown> = {}) => ({
    id, username: 'nattapat', problem_id: 'vec', problem_title: 'vector::erase', overall_status: 'Wrong Answer',
    score: 60, language: 'cpp', submitted_at: new Date().toISOString(),
    case_statuses: ['Accepted', 'Wrong Answer'], max_time_ms: 410, max_memory_kb: 12595, ...over,
});

const renderAt = (url = '/submissions') => render(<MemoryRouter initialEntries={[url]}><Submissions /></MemoryRouter>);

describe('Submissions page', () => {
    beforeEach(() => {
        jest.mocked(useAuth).mockReturnValue({ user: student, isLoading: false, refreshUser: jest.fn() } as never);
        jest.mocked(submissionService.getAll).mockResolvedValue([row(48213), row(48207, { overall_status: 'Accepted', score: 100, case_statuses: ['Accepted', 'Accepted'] })] as never);
    });

    it('rows link to the detail route and show verdict, strip and limits used', async () => {
        renderAt();
        await screen.findByRole('link', { name: '#48213' });
        const table = screen.getByRole('table', { name: 'Submissions' });
        const first = within(table).getAllByRole('row')[1];
        expect(within(first).getByRole('link', { name: /#48213/ })).toHaveAttribute('href', '/submissions/48213');
        expect(within(first).getByText('WRONG 1/2')).toBeInTheDocument();
        expect(within(first).getByText('410 ms')).toBeInTheDocument();
        expect(within(first).getByText('12.3 MB')).toBeInTheDocument();
    });

    it('only rows the viewer may open link to a detail page (the server lets owners and staff in)', async () => {
        jest.mocked(submissionService.getAll).mockResolvedValue([row(48213), row(48300, { username: 'ploy.s' })] as never);
        const view = renderAt();
        await screen.findByRole('link', { name: '#48213' });
        const table = screen.getByRole('table', { name: 'Submissions' });
        const other = within(table).getAllByRole('row')[2];
        expect(within(other).getByText('#48300')).toBeInTheDocument();
        expect(within(other).queryByRole('link', { name: /#48300|vector::erase/ })).toBeNull();
        view.unmount();

        jest.mocked(useAuth).mockReturnValue({ user: staff, isLoading: false, refreshUser: jest.fn() } as never);
        renderAt();
        expect(await screen.findByRole('link', { name: '#48300' })).toHaveAttribute('href', '/submissions/48300');
    });

    it('a guest sees the feed with no detail links', async () => {
        jest.mocked(useAuth).mockReturnValue({ user: null, isLoading: false, refreshUser: jest.fn() } as never);
        renderAt();
        expect(await screen.findByText('#48213')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: '#48213' })).toBeNull();
    });

    it('never nests a link inside the row link (the problem title is plain text)', async () => {
        const { container } = renderAt();
        await screen.findByRole('link', { name: '#48213' });
        expect(container.querySelector('a a')).toBeNull();
    });

    it('draws no testcase strip for a compile error (the judge stores its log as one result entry)', async () => {
        jest.mocked(submissionService.getAll).mockResolvedValue([
            row(48101, { overall_status: 'Compilation Error', score: 0, case_statuses: ['Compilation Error'], max_time_ms: null, max_memory_kb: null }),
        ] as never);
        renderAt();
        await screen.findByRole('link', { name: '#48101' });
        const table = screen.getByRole('table', { name: 'Submissions' });
        const first = within(table).getAllByRole('row')[1];
        expect(within(first).getByText('COMPILATION ERROR')).toBeInTheDocument();
        expect(within(first).queryByRole('img', { name: /test cases passed/ })).toBeNull();
    });

    it('All is the default when logged in, Mine one click away', async () => {
        renderAt();
        await waitFor(() => expect(submissionService.getAll).toHaveBeenCalledWith(expect.objectContaining({ filter: 'all' })));
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
        await waitFor(() => expect(submissionService.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'mine' })));
    });

    it('verdict chip sends verdict', async () => {
        renderAt();
        await screen.findByRole('table', { name: 'Submissions' });
        fireEvent.click(screen.getByRole('button', { name: 'Add filter: Verdict' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Time limit' }));
        await waitFor(() => expect(submissionService.getAll).toHaveBeenLastCalledWith(
            expect.objectContaining({ verdict: 'Time Limit Exceeded' }),
        ));
    });

    it('staff see the user filter, students do not', async () => {
        const { unmount } = renderAt();
        await screen.findByRole('table', { name: 'Submissions' });
        expect(screen.queryByRole('searchbox', { name: 'Filter by username' })).toBeNull();
        unmount();
        jest.mocked(useAuth).mockReturnValue({ user: staff, isLoading: false, refreshUser: jest.fn() } as never);
        renderAt('/submissions?user=natt');
        expect(await screen.findByRole('searchbox', { name: 'Filter by username' })).toHaveValue('natt');
        await waitFor(() => expect(submissionService.getAll).toHaveBeenCalledWith(expect.objectContaining({ filterUserId: 'natt' })));
    });

    it('list refreshes on a submission event', async () => {
        let push: (p: SubmissionUpdatePayload) => void = () => undefined;
        jest.mocked(subscribeSubmissions).mockImplementation((onUpdate) => { push = onUpdate; return () => undefined; });
        renderAt();
        await screen.findByRole('table', { name: 'Submissions' });
        const calls = jest.mocked(submissionService.getAll).mock.calls.length;
        await act(async () => push({ type: 'submission_update', submissionId: 1, table: 'submissions', overall_status: 'Accepted', score: 100, user_id: 7 }));
        await waitFor(() => expect(submissionService.getAll).toHaveBeenCalledTimes(calls + 1));
    });

    it('shows an error state when the list fails', async () => {
        jest.mocked(submissionService.getAll).mockRejectedValue(new Error('down'));
        renderAt();
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch submissions.');
    });
});
