import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SubmissionDetailPage from '../../pages/submission/SubmissionDetailPage';
import submissionService from '../../services/submissionService';

jest.mock('../../services/submissionService');
jest.mock('../../services/realtimeService', () => ({
    ...jest.requireActual('../../services/realtimeService'),
    subscribeSubmissions: jest.fn(() => () => undefined),
}));

const detail = {
    id: 48213, username: 'nattapat', problem_id: 'vec', problem_title: 'vector::erase', problem_name: 'vector::erase',
    overall_status: 'Wrong Answer', score: 60, language: 'cpp', submitted_at: new Date().toISOString(),
    code: 'int main() {\n  return 0;\n}', max_time_ms: 410, max_memory_kb: 12595,
    results: [{ testCase: 1, status: 'Accepted', timeMs: 30, memoryKb: 3900 }, { testCase: 2, status: 'Wrong Answer', timeMs: 410, memoryKb: 12595 }],
    time_limit_ms: 1000, memory_limit_mb: 256,
};

const renderAt = (url: string) => render(
    <MemoryRouter initialEntries={[url]}>
        <Routes>
            <Route path="/submissions/:submissionId" element={<SubmissionDetailPage />} />
            <Route path="/contests/:contestId/submissions/:submissionId" element={<SubmissionDetailPage />} />
        </Routes>
    </MemoryRouter>,
);

describe('SubmissionDetailPage', () => {
    it('detail shows the result, code and copy', async () => {
        jest.mocked(submissionService.getById).mockResolvedValue(detail as never);
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        renderAt('/submissions/48213');
        expect(await screen.findByRole('heading', { level: 1, name: 'Submission #48213' })).toBeInTheDocument();
        const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
        expect(within(crumbs).getByRole('link', { name: 'Submissions' })).toHaveAttribute('href', '/submissions');
        expect(await screen.findByText('WRONG ANSWER')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open problem' })).toHaveAttribute('href', '/problems/vec');
        expect(screen.getByRole('link', { name: 'Edit & resubmit' })).toHaveAttribute('href', '/problems/vec?tab=submit');
        const code = screen.getByRole('region', { name: 'Submitted code' });
        const source = (_: string, el: Element | null) => el?.tagName === 'CODE' && Boolean(el.textContent?.includes('return 0;'));
        expect(within(code).getByText(source)).toBeInTheDocument();
        fireEvent.click(within(code).getByRole('button', { name: 'Copy' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(detail.code));
        expect(await within(code).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
        fireEvent.click(within(code).getByRole('button', { name: /Submitted code/ }));
        expect(within(code).queryByText(source)).toBeNull();
    });

    it('a Python run is measured against the limits the judge gave it (time x4, memory x2)', async () => {
        jest.mocked(submissionService.getById).mockResolvedValue({ ...detail, language: 'python' } as never);
        renderAt('/submissions/48213');
        expect(await screen.findByText(/Time \/ 4000 ms/)).toBeInTheDocument();
        expect(screen.getByText(/Memory \/ 512 MB/)).toBeInTheDocument();
    });

    it('Edit & resubmit brings this submission\'s code and language into the editor', async () => {
        localStorage.clear();
        jest.mocked(submissionService.getById).mockResolvedValue({ ...detail, language: 'python', code: 'print(42)' } as never);
        renderAt('/submissions/48213');
        fireEvent.click(await screen.findByRole('link', { name: 'Edit & resubmit' }));
        const cache = JSON.parse(localStorage.getItem('oj-submission-cache') ?? '{}');
        expect(cache['vec:python'].code).toBe('print(42)');
    });

    it('passes the contest id through on contest routes', async () => {
        jest.mocked(submissionService.getById).mockResolvedValue(detail as never);
        renderAt('/contests/3/submissions/48213');
        await screen.findByRole('heading', { level: 1, name: 'Submission #48213' });
        expect(submissionService.getById).toHaveBeenCalledWith(48213, '3');
        expect(await screen.findByRole('link', { name: 'Open problem' })).toHaveAttribute('href', '/contests/3/problems/vec');
    });

    it('detail 403 shows an inline error', async () => {
        jest.mocked(submissionService.getById).mockRejectedValue({ response: { status: 403 } });
        renderAt('/submissions/48213');
        expect(await screen.findByRole('alert')).toHaveTextContent("You can't view this submission.");
    });
});
