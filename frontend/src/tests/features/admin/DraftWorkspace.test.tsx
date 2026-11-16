import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import useStatementPreview from '../../../features/admin/authoring/useStatementPreview';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
import { DraftMetadata, DraftStatement, DraftSolution, DraftVerify } from '../../../features/admin/authoring/DraftWorkspace';

jest.mock('../../../services/api');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../features/admin/authoring/useStatementPreview', () => ({ __esModule: true, default: jest.fn() }));

const base = {
  id: 'd1', problemId: 'hp_graph_bfs', title: 'Shortest hops', authorProfileId: null, authorAkaName: 'Ada', authorRealName: 'Ada L',
  language: 'Thai', countryCode: 'THA', categories: [], difficulty: null, timeLimitMs: 1000, memoryLimitMb: 256,
  statementHtml: '<p>x</p>', solutionCpp: 'int main(){}', generatorCpp: null, templateVersion: 'red-gate-v1',
  revision: 3, verifiedRevision: null, hasLatestPdf: true, latestPdfRevision: 3, status: 'generated', publishedAt: null,
  hasAuthorProfileImage: false, updatedAt: '2026-11-16T00:00:00Z', testcaseStats: { total: 2, withOutput: 2 },
};
const job = (over = {}) => ({
  id: 'j1', draftId: 'd1', draftRevision: 3, jobType: 'compile_solution', status: 'succeeded',
  createdAt: '2026-11-16T01:00:00Z', errorCode: null, errorMessage: null, ...over,
});

let draft: Record<string, unknown> = base;
let jobs: Array<Record<string, unknown>> = [];
const serve = () => jest.mocked(api.get).mockImplementation(async (url: string) => ({
  data: url.endsWith('/jobs') ? jobs : url.endsWith('/testcases') ? { revision: draft.revision, testcases: [] } : url.endsWith('/d1') ? draft : [],
}));

const show = (path = '/admin/authoring/d1') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/authoring" element={<p>drafts list</p>} />
      <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />}>
        <Route index element={<DraftMetadata />} />
        <Route path="metadata" element={<DraftMetadata />} />
        <Route path="statement" element={<DraftStatement />} />
        <Route path="solution" element={<DraftSolution />} />
        <Route path="verify" element={<DraftVerify />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);
const steps = () => screen.getByRole('navigation', { name: 'Draft steps' });

describe('Draft workspace header and step tabs (§7.9)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.sessionStorage.clear();
    jest.mocked(useStatementPreview).mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'staff' }, isLoading: false } as ReturnType<typeof useAuth>);
    draft = base;
    jobs = [];
    serve();
  });

  it('the old left rail is gone; the breadcrumb leads back to Authoring', async () => {
    show();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Shortest hops');
    expect(screen.queryByText('← All drafts')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: /breadcrumb/i })).getByRole('link', { name: 'Authoring' })).toHaveAttribute('href', '/admin/authoring');
    expect(screen.getAllByText(/hp_graph_bfs/).length).toBeGreaterThan(0);
  });

  it('save state reads Saved · rev N, then Unsaved after an edit', async () => {
    show();
    expect(await screen.findByText('Saved · rev 3')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Shortest hops II' } });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('primary is Verify when the draft is not verified at its revision', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: job({ jobType: 'verify_all', status: 'queued' }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/verify$/), expect.anything()));
  });

  it('primary is Publish when it can publish, and asks first', async () => {
    draft = { ...base, status: 'ready', verifiedRevision: 3 };
    serve();
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('dialog', { name: 'Publish this problem?' })).toBeInTheDocument();
  });

  it('while a job runs there is no primary, only the job pill; when it finishes the primary returns', async () => {
    jobs = [job({ status: 'running' })];
    serve();
    show();
    expect(await screen.findByText('Compile solution · running')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    jobs = [job({ status: 'failed' })];
    expect(await screen.findByRole('button', { name: 'Verify' }, { timeout: 3000 })).toBeInTheDocument();
    expect(within(steps()).getByRole('link', { name: 'Solution, failed' })).toBeInTheDocument();
  });

  it('a server change under unsaved edits keeps the conflict banner and never claims Saved', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Mine' } });
    draft = { ...base, revision: 4 };
    serve();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText('Server state changed. Your unsaved text is retained.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard local changes and sync' })).toBeInTheDocument();
    expect(screen.queryByText(/^Saved · rev/)).toBeNull();
  });

  it('a published draft has no primary; its menu offers Start new revision', async () => {
    const user = userEvent.setup({ delay: 20 });
    draft = { ...base, status: 'published', verifiedRevision: 3, publishedAt: '2026-11-10T00:00:00Z' };
    serve();
    jest.mocked(api.post).mockResolvedValue({ data: { ...base, status: 'draft', revision: 4 } });
    show();
    await screen.findByText(/Published · read-only/);
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More draft actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Start new revision' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/new-revision$/), expect.anything()));
  });

  it('step glyphs: done, to do, out of date', async () => {
    draft = { ...base, latestPdfRevision: 2, testcaseStats: { total: 3, withOutput: 2 } };
    jobs = [job()];
    serve();
    show();
    await screen.findByText('Saved · rev 3');
    const nav = steps();
    expect(within(nav).getByRole('link', { name: 'Metadata, done' })).toHaveAttribute('href', '/admin/authoring/d1/metadata');
    expect(within(nav).getByRole('link', { name: 'Statement, out of date' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Solution, done' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Generator, to do' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Testcases, out of date' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Verify & publish, to do' })).toHaveAttribute('href', '/admin/authoring/d1/verify');
    expect(within(nav).getByRole('link', { name: 'History' })).toHaveAttribute('href', '/admin/authoring/d1/jobs');
    expect(within(nav).getByRole('link', { name: 'AI docs' })).toHaveAttribute('href', '/admin/authoring/d1/ai-docs');
  });

  it('final review: a failed job at this revision turns its glyph red and says so above the tab', async () => {
    jobs = [job({ jobType: 'generate_outputs', status: 'failed', errorMessage: 'case 3 crashed' })];
    draft = { ...base, testcaseStats: { total: 3, withOutput: 1 } };
    serve();
    show('/admin/authoring/d1/metadata');
    await screen.findByText('Saved · rev 3');
    expect(within(steps()).getByRole('link', { name: 'Testcases, failed' })).toBeInTheDocument();
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Generate outputs failed at rev 3');
    expect(notice).toHaveTextContent('case 3 crashed');
    expect(within(notice).getByRole('link', { name: 'See History' })).toHaveAttribute('href', '/admin/authoring/d1/jobs');
  });

  it('final review: the plain draft URL marks Metadata as the current step', async () => {
    show('/admin/authoring/d1');
    await screen.findByText('Saved · rev 3');
    expect(within(steps()).getByRole('link', { name: 'Metadata, done' })).toHaveAttribute('aria-current', 'page');
  });

  it('minor: under a server conflict the header save state reads Unsaved', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Mine' } });
    draft = { ...base, revision: 4 };
    serve();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await screen.findByText('Server state changed. Your unsaved text is retained.');
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(within(header).getByText('Unsaved')).toBeInTheDocument();
    expect(within(header).queryByText('Server state changed')).toBeNull();
  });

  it('minor: the header Verify is disabled while the solution is empty', async () => {
    draft = { ...base, solutionCpp: '  ' };
    serve();
    show();
    expect(await screen.findByRole('button', { name: 'Verify' })).toBeDisabled();
  });

  it('the Verify & publish tab has no header primary (its footer holds the buttons)', async () => {
    show('/admin/authoring/d1/verify');
    await screen.findByText('Saved · rev 3');
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(within(header).queryByRole('button', { name: 'Verify' })).toBeNull();
  });
});
