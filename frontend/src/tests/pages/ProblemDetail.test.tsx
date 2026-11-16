import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ProblemDetail from '../../pages/problem/ProblemDetail';
import problemService from '../../services/problemService';
import submissionService from '../../services/submissionService';
import { subscribeSubmissions } from '../../services/realtimeService';

jest.mock('../../services/problemService');
jest.mock('../../services/submissionService');
jest.mock('../../services/realtimeService', () => ({
    ...jest.requireActual('../../services/realtimeService'),
    subscribeSubmissions: jest.fn(() => () => undefined),
}));
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useParams: () => ({ problemId: '1' }),
}));
// The Submissions tab renders the existing list; keep it out of these tests.
jest.mock('../../pages/submission/Submissions', () => () => <div>Submissions list</div>);

const detail = (over: Record<string, unknown> = {}) => ({
    id: '1', title: 'Test Problem', author: 'Ada', difficulty: 1200, categories: [],
    time_limit_ms: 1000, memory_limit_mb: 256, has_pdf: true, problem_type: 'standard',
    submission_filename: null, has_starter_files: false,
    collection: { id: 2, name: 'Basics' },
    viewerBest: { score: 60, caseStatuses: ['Accepted', 'Wrong Answer'] },
    viewerSubmissionCount: 3,
    ...over,
});
const accepted = {
    id: 77, username: 'u', problem_id: '1', overall_status: 'Accepted', score: 100, language: 'cpp',
    submitted_at: new Date().toISOString(), code: 'int main(){}', max_time_ms: 12, max_memory_kb: 900,
    results: [{ testCase: 1, status: 'Accepted', timeMs: 12, memoryKb: 900 }],
    time_limit_ms: 1000, memory_limit_mb: 256,
};

const renderPage = (search = '') => {
    window.history.replaceState({}, '', `/problems/1${search}`);
    return render(<BrowserRouter><ProblemDetail /></BrowserRouter>);
};

describe('ProblemDetail page', () => {
    beforeEach(() => {
        jest.mocked(problemService.getDetails).mockResolvedValue(detail() as never);
        jest.mocked(problemService.getPdfUrl).mockReturnValue('/api/problems/1/pdf');
        jest.mocked(problemService.getStarterUrl).mockReturnValue('/api/problems/1/starter');
        jest.mocked(subscribeSubmissions).mockImplementation(() => () => undefined);
        localStorage.clear();
    });

    it('header shows id, limits, languages and author', async () => {
        renderPage();
        expect(await screen.findByRole('heading', { level: 1, name: 'Test Problem' })).toBeInTheDocument();
        expect(screen.getByText('1000 ms · 256 MB')).toBeInTheDocument();
        expect(screen.getByText('C++ · Python')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute('href', '/problems?author=Ada');
        const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i });
        expect(within(crumbs).getByRole('link', { name: 'Basics' })).toHaveAttribute('href', '/problems?collection=2');
        expect(screen.getByRole('img', { name: '1 of 2 test cases passed' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Submissions 3' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', '/api/problems/1/pdf');
    });

    it('header problems show the submit filename and the starter action', async () => {
        jest.mocked(problemService.getDetails).mockResolvedValue(detail({
            problem_type: 'header', submission_filename: 'student.h', has_starter_files: true,
        }) as never);
        renderPage();
        expect(await screen.findByText('C++ · submit student.h')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Starter' })).toHaveAttribute('href', '/api/problems/1/starter');
    });

    it('tab lives in the URL', async () => {
        renderPage();
        await screen.findByRole('heading', { level: 1, name: 'Test Problem' });
        expect(screen.getByRole('tab', { name: 'Statement' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: 'Submit' }));
        expect(window.location.search).toBe('?tab=submit');
        expect(screen.getByRole('tab', { name: 'Submit' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /^Submit/ })).toBeInTheDocument();
    });

    it('the statement is the PDF frame alone, without an open-PDF line under it', async () => {
        renderPage();
        expect(await screen.findByTitle('Test Problem statement')).toBeInTheDocument();
        expect(screen.queryByText(/Can't preview it here/)).toBeNull();
        expect(screen.queryByRole('link', { name: 'open PDF' })).toBeNull();
    });

    it('submitting opens the new submission\'s own page, which follows the verdict live', async () => {
        jest.mocked(submissionService.submit).mockResolvedValue({ message: 'ok', submissionId: 77, isContestSubmission: false } as never);
        renderPage('?tab=submit');
        const editor = await screen.findByLabelText(/Your code/i);
        fireEvent.click(screen.getByRole('button', { name: 'C++' }));
        fireEvent.change(editor, { target: { value: 'int main(){}' } });
        fireEvent.click(screen.getByRole('button', { name: /^Submit/ }));
        await waitFor(() => expect(window.location.pathname).toBe('/submissions/77'));
        expect(submissionService.submit).toHaveBeenCalledWith({ problemId: '1', language: 'cpp', code: 'int main(){}' });
        expect(screen.queryByRole('region', { name: 'Result' })).toBeNull();
    });

    it('an old link with ?submission= opens that submission\'s page', async () => {
        renderPage('?tab=submit&submission=77');
        await waitFor(() => expect(window.location.pathname).toBe('/submissions/77'));
    });

    it('Cmd+Enter submits', async () => {
        jest.mocked(submissionService.submit).mockResolvedValue({ message: 'ok', submissionId: 78, isContestSubmission: false } as never);
        jest.mocked(submissionService.getById).mockResolvedValue({ ...accepted, id: 78 } as never);
        renderPage('?tab=submit');
        const editor = await screen.findByLabelText(/Your code/i);
        fireEvent.click(screen.getByRole('button', { name: 'C++' }));
        fireEvent.change(editor, { target: { value: 'print(1)' } });
        fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
        await waitFor(() => expect(submissionService.submit).toHaveBeenCalledTimes(1));
    });

    it('a dropped file fills the editor', async () => {
        renderPage('?tab=submit');
        const editor = await screen.findByLabelText(/Your code/i);
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['int main() { return 0; }'], 'solution.cpp', { type: 'text/plain' });
        await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
        await waitFor(() => expect(editor).toHaveValue('int main() { return 0; }'));
    });

    it('a dropped file of the other language switches language and keeps the file', async () => {
        renderPage('?tab=submit');
        const editor = await screen.findByLabelText(/Your code/i);
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['print(sum(map(int, input().split())))'], 'sol.py', { type: 'text/plain' });
        await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Python' })).toHaveAttribute('aria-pressed', 'true'));
        await waitFor(() => expect(screen.getByLabelText(/Your code/i)).toHaveValue('print(sum(map(int, input().split())))'));
        expect(editor).toBeTruthy();
    });

    it('shows the staff-only notice for a hidden problem', async () => {
        jest.mocked(problemService.getDetails).mockResolvedValue(detail({ is_visible: false }) as never);
        renderPage();
        expect(await screen.findByText(/only visible to staff/)).toBeInTheDocument();
    });

    it('displays the error when the problem fails to load', async () => {
        jest.mocked(problemService.getDetails).mockRejectedValue({ response: { status: 404 } });
        renderPage();
        expect(await screen.findByText('Problem 1 not found.')).toBeInTheDocument();
    });
});
