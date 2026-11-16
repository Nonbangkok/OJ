import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import useStatementPreview from '../../../features/admin/authoring/useStatementPreview';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
import { DraftJobs, DraftSolution, DraftTestcases, DraftVerify } from '../../../features/admin/authoring/DraftWorkspace';

jest.mock('../../../services/api');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../features/admin/authoring/useStatementPreview', () => ({ __esModule: true, default: jest.fn() }));

const base = {
  id: 'd1', problemId: 'hp_graph_bfs', title: 'Shortest hops', authorProfileId: null, authorAkaName: 'Ada', authorRealName: 'Ada L',
  language: 'Thai', countryCode: 'THA', categories: [], difficulty: null, timeLimitMs: 1000, memoryLimitMb: 256,
  statementHtml: '<p>x</p>', solutionCpp: 'int main(){}', generatorCpp: null, templateVersion: 'red-gate-v1',
  revision: 14, verifiedRevision: 12, hasLatestPdf: true, latestPdfRevision: 12, status: 'generated', publishedAt: null,
  hasAuthorProfileImage: false, updatedAt: '2026-11-16T00:00:00Z', testcaseStats: { total: 24, withOutput: 24 },
};
const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1', draftId: 'd1', draftRevision: 14, jobType: 'compile_solution', status: 'succeeded', createdAt: '2026-11-16T01:00:00Z',
  errorCode: null, errorMessage: null, resultSummary: null, ...over,
});
// 24 cases, 3.1 MB in all.
const testcases = Array.from({ length: 24 }, (_, i) => ({
  id: `c${i + 1}`, caseNumber: i + 1, filename: `${i + 1}.in`, inputBytes: 100_000, outputBytes: 29_167, hasOutput: true,
  source: 'generated', sourceRevision: 13, createdAt: '', updatedAt: '',
}));
let draft: Record<string, unknown> = base;
let jobs: Array<Record<string, unknown>> = [];
const serve = () => jest.mocked(api.get).mockImplementation(async (url: string) => ({
  data: url.endsWith('/jobs') ? jobs
    : url.includes('/admin/authoring/jobs/') ? jobs.find((j) => url.endsWith(`/${j.id as string}`))
      : url.endsWith('/testcases') ? { revision: 14, testcases } : url.endsWith('/d1') ? draft : [],
}));
const show = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />}>
        <Route path="solution" element={<DraftSolution />} />
        <Route path="testcases" element={<DraftTestcases />} />
        <Route path="verify" element={<DraftVerify />} />
        <Route path="jobs" element={<DraftJobs />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);
const readiness = () => screen.getByRole('list', { name: 'Publish readiness' });
const row = (title: RegExp | string) => within(readiness()).getByText(title).closest('li') as HTMLElement;

describe('Verify & publish (§7.9)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.sessionStorage.clear();
    jest.mocked(useStatementPreview).mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'staff' }, isLoading: false } as ReturnType<typeof useAuth>);
    draft = base;
    jobs = [job()];
    serve();
  });

  it('lists every readiness row with a state, a detail and a fix', async () => {
    show('/admin/authoring/d1/verify');
    await screen.findByRole('list', { name: 'Publish readiness' });
    expect(within(readiness()).getAllByRole('listitem')).toHaveLength(6);
    expect(row('Metadata')).toHaveTextContent(/done/i);
    expect(row('Statement')).toHaveTextContent(/done/i);
    expect(row('Solution compiles at rev 14')).toHaveTextContent(/done/i);
    expect(await within(row('Testcases')).findByText('24 cases, all with outputs · 3.1 MB')).toBeInTheDocument();
    const pdf = row('PDF current');
    expect(pdf).toHaveTextContent('The PDF is from rev 12.');
    expect(pdf).toHaveTextContent(/out of date/i);
    expect(within(pdf).getByRole('button', { name: 'Rebuild PDF' })).toBeInTheDocument();
    const verified = row('Verified at rev 14');
    expect(verified).toHaveTextContent('Last verified at rev 12.');
    expect(within(verified).getByRole('button', { name: 'Run Verify' })).toBeInTheDocument();
  });

  it('fix links run the job or open the tab', async () => {
    draft = { ...base, testcaseStats: { total: 5, withOutput: 3 } };
    jobs = [job({ draftRevision: 13 })];
    serve();
    jest.mocked(api.post).mockResolvedValue({ data: job({ id: 'j9', status: 'queued' }) });
    show('/admin/authoring/d1/verify');
    await screen.findByRole('list', { name: 'Publish readiness' });
    fireEvent.click(within(row('Solution compiles at rev 14')).getByRole('button', { name: 'Compile now' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/compile$/), expect.objectContaining({ target: 'solution' })));
    expect(row('Testcases')).toHaveTextContent('2 of 5 cases missing outputs');
    fireEvent.click(within(row('Testcases')).getByRole('button', { name: 'Open testcases' }));
    expect(await screen.findByRole('table', { name: 'Testcases' })).toBeInTheDocument();
  });

  it('Rebuild PDF starts the PDF job', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: job({ id: 'j9', jobType: 'build_pdf', status: 'queued' }) });
    show('/admin/authoring/d1/verify');
    await screen.findByRole('list', { name: 'Publish readiness' });
    fireEvent.click(within(row('PDF current')).getByRole('button', { name: 'Rebuild PDF' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/pdf$/), expect.anything()));
  });

  it('a disabled Publish says why, from the failing rows', async () => {
    show('/admin/authoring/d1/verify');
    await screen.findByRole('list', { name: 'Publish readiness' });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText('Rebuild the PDF and verify rev 14 before publishing.')).toBeInTheDocument();
    jest.mocked(api.post).mockResolvedValue({ data: job({ id: 'j9', jobType: 'verify_all', status: 'queued' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/verify$/), expect.anything()));
  });

  it('an enabled Publish opens the existing confirm', async () => {
    draft = { ...base, status: 'ready', verifiedRevision: 14, latestPdfRevision: 14 };
    jobs = [job({ jobType: 'verify_all', resultSummary: { verification: { caseCount: 24 } } })];
    serve();
    show('/admin/authoring/d1/verify');
    await screen.findByRole('list', { name: 'Publish readiness' });
    expect(row('Verified at rev 14')).toHaveTextContent(/24 testcases ran against the solution/);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('dialog', { name: 'Publish this problem?' })).toBeInTheDocument();
  });

  it('a failed verify shows the failing case and a plain-language explanation', async () => {
    jobs = [job({ jobType: 'verify_all', status: 'failed', errorCode: 'wrong_answer', errorMessage: 'output mismatch',
      resultSummary: { failedCase: { caseNumber: 7, durationMs: 12 } } })];
    serve();
    show('/admin/authoring/d1/verify');
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(/Solution output does not match the expected output/i);
    expect(notice).toHaveTextContent('Failing testcase: #7');
    expect(row('Verified at rev 14')).toHaveTextContent(/failed/i);
  });
});

describe('History (§7.9)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.sessionStorage.clear();
    jest.mocked(useStatementPreview).mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'staff' }, isLoading: false } as ReturnType<typeof useAuth>);
    draft = base;
    jobs = [
      job({ id: 'v1', jobType: 'verify_all', status: 'failed', errorCode: 'wrong_answer', draftRevision: 12,
        resultSummary: { failedCase: { caseNumber: 7, durationMs: 12 }, verification: {
          checks: { compile: 'passed', outputs: 'failed' }, caseCount: 24, totalTestcaseBytes: 3_100_000, memoryLimitMb: 256,
          peakMemoryBytes: null, warnings: [], cases: [{ caseId: 'c1', caseNumber: 1, durationMs: 30 }] } },
        log: 'case 7: expected 3, got 4' }),
      job({ id: 'g1', jobType: 'run_generator', status: 'timed_out', draftRevision: 11 }),
    ];
    serve();
  });

  it('columns are Job, Result, Revision and When, with Task 3 labels', async () => {
    show('/admin/authoring/d1/jobs');
    const table = await screen.findByRole('table', { name: 'Job history' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Job', 'Result', 'Revision', 'When']);
    const verifyRow = within(table).getByText('Verify All').closest('tr') as HTMLElement;
    expect(verifyRow).toHaveTextContent('Failed · case 7 wrong answer');
    expect(verifyRow).toHaveTextContent('rev 12');
    const genRow = within(table).getByText('Generate inputs').closest('tr') as HTMLElement;
    expect(genRow).toHaveTextContent('Timed out');
  });

  it('a row click opens a drawer with the failure, checks, cases and log', async () => {
    show('/admin/authoring/d1/jobs');
    const table = await screen.findByRole('table', { name: 'Job history' });
    fireEvent.click(within(table).getByRole('button', { name: 'Verify All' }));
    const drawer = await screen.findByRole('dialog', { name: 'Verify All · rev 12' });
    expect(within(drawer).getByRole('alert')).toHaveTextContent(/Solution output does not match/i);
    expect(drawer).toHaveTextContent(/outputs\s*failed/);
    expect(within(drawer).getByRole('table', { name: 'Cases' })).toBeInTheDocument();
    expect(drawer).toHaveTextContent('case 7: expected 3, got 4');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/authoring/jobs/v1'));
  });
});
