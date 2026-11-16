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

    it('Mine is the default when logged in', async () => {
        renderAt();
        await waitFor(() => expect(submissionService.getAll).toHaveBeenCalledWith(expect.objectContaining({ filter: 'mine' })));
        expect(screen.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'All' }));
        await waitFor(() => expect(submissionService.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'all' })));
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
