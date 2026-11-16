import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import useStatementPreview from '../../../features/admin/authoring/useStatementPreview';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
import { DraftSolution, DraftGenerator, DraftTestcases } from '../../../features/admin/authoring/DraftWorkspace';

jest.mock('../../../services/api');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../hooks/useMediaQuery', () => ({ useMediaQuery: jest.fn() }));
jest.mock('../../../features/admin/authoring/useStatementPreview', () => ({ __esModule: true, default: jest.fn() }));

const base = {
  id: 'd1', problemId: 'hp_graph_bfs', title: 'Shortest hops', authorProfileId: null, authorAkaName: 'Ada', authorRealName: 'Ada L',
  language: 'Thai', countryCode: 'THA', categories: [], difficulty: null, timeLimitMs: 1000, memoryLimitMb: 256,
  statementHtml: '<p>x</p>', solutionCpp: 'int main(){}', generatorCpp: null, templateVersion: 'red-gate-v1',
  revision: 14, verifiedRevision: null, hasLatestPdf: false, latestPdfRevision: null, status: 'generated', publishedAt: null,
  hasAuthorProfileImage: false, updatedAt: '2026-11-16T00:00:00Z', testcaseStats: { total: 2, withOutput: 1 },
};
const compile = (over = {}) => ({
  id: 'j1', draftId: 'd1', draftRevision: 14, jobType: 'compile_solution', status: 'succeeded', createdAt: '2026-11-16T01:00:00Z',
  errorCode: null, errorMessage: null, resultSummary: { durationMs: 1800, warnings: [] }, ...over,
});
const testcases = [
  { id: 'c1', caseNumber: 1, filename: '1.in', inputBytes: 10, outputBytes: 5, hasOutput: true, source: 'generated', sourceRevision: 13, createdAt: '', updatedAt: '' },
  { id: 'c2', caseNumber: 2, filename: 'big_line.in', inputBytes: 2_400_000, outputBytes: null, hasOutput: false, source: 'uploaded', sourceRevision: 9, createdAt: '', updatedAt: '' },
];
let draft: Record<string, unknown> = base;
let jobs: Array<Record<string, unknown>> = [];
const serve = () => jest.mocked(api.get).mockImplementation(async (url: string) => ({
  data: url.endsWith('/jobs') ? jobs : url.endsWith('/testcases') ? { revision: 14, testcases } : url.endsWith('/d1') ? draft : [],
}));
const show = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />}>
        <Route path="solution" element={<DraftSolution />} />
        <Route path="generator" element={<DraftGenerator />} />
        <Route path="testcases" element={<DraftTestcases />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe('Solution, Generator and Testcases tabs (§7.9)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.sessionStorage.clear();
    jest.mocked(useMediaQuery).mockReturnValue(false);
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'staff' }, isLoading: false } as ReturnType<typeof useAuth>);
    jest.mocked(useStatementPreview).mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
    draft = base;
    jobs = [compile()];
    serve();
  });

  it('Solution: the last compile at this revision, and Compile', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: compile({ status: 'queued' }) });
    show('/admin/authoring/d1/solution');
    const panel = await screen.findByRole('region', { name: 'Last compile' });
    expect(panel).toHaveTextContent('OK');
    expect(panel).toHaveTextContent(/Revision\s*14/);
    expect(panel).toHaveTextContent(/Time\s*1\.8 s/);
    expect(panel).toHaveTextContent(/Warnings\s*0/);
    expect(screen.getByText('solution.cpp')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/compile$/), expect.objectContaining({ target: 'solution' })));
  });

  it('Solution: an older compile says the code changed since; a running job makes it read-only', async () => {
    jobs = [compile({ draftRevision: 13 }), compile({ id: 'j2', jobType: 'build_pdf', status: 'running', createdAt: '2026-11-16T02:00:00Z' })];
    serve();
    show('/admin/authoring/d1/solution');
    expect(await screen.findByText(/Compiled at rev 13 — the code changed since/)).toBeInTheDocument();
    expect(screen.getByText('Read-only while the job runs')).toBeInTheDocument();
  });

  it('Generator: without one, a notice and a template to start from', async () => {
    show('/admin/authoring/d1/generator');
    expect(await screen.findByText('No generator — testcases can be uploaded instead.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start from the template' }));
    await waitFor(() => expect(screen.queryByText('No generator — testcases can be uploaded instead.')).toBeNull());
    expect(screen.getByRole('button', { name: 'Generate inputs' })).toBeInTheDocument();
  });

  it('Testcases: a summary line, sizes and where each case came from', async () => {
    show('/admin/authoring/d1/testcases');
    expect(await screen.findByText('2 testcases · 2.4 MB')).toBeInTheDocument();
    expect(screen.getByText('1 missing output')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Testcases' });
    const first = within(table).getByText('1.in').closest('tr') as HTMLElement;
    expect(first).toHaveTextContent('generated · rev 13');
    const second = within(table).getByText('big_line.in').closest('tr') as HTMLElement;
    expect(second).toHaveTextContent('uploaded');
    expect(second).toHaveTextContent('Missing output');
    expect(screen.getByRole('button', { name: 'Generate outputs' })).toBeInTheDocument();
  });

  it('phone: code is read-only with a notice, testcases are view-only', async () => {
    jest.mocked(useMediaQuery).mockReturnValue(true);
    show('/admin/authoring/d1/solution');
    expect(await screen.findByText('Best edited on a larger screen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compile' })).toBeNull();
  });

  it('phone: testcases can be inspected but not changed', async () => {
    jest.mocked(useMediaQuery).mockReturnValue(true);
    show('/admin/authoring/d1/testcases');
    expect(await screen.findByRole('button', { name: 'Inspect 1.in' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Append testcase' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete 1.in' })).toBeNull();
    expect(screen.getByText('Best edited on a larger screen')).toBeInTheDocument();
  });
});
