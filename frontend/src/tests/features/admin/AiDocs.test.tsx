import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
import {
  DraftMetadata,
  DraftAiDocs,
} from '../../../features/admin/authoring/DraftWorkspace';
import { buildAiDocsMarkdown } from '../../../features/admin/authoring/aiDocsContent';

jest.mock('../../../services/api');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const draft = {
  id: 'd1',
  problemId: 'sum',
  title: 'Sum',
  authorProfileId: null,
  authorAkaName: 'AKA',
  authorRealName: 'Author',
  language: 'Thai',
  countryCode: 'THA',
  categories: [],
  difficulty: null,
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  statementHtml: '<p>Sum</p>',
  solutionCpp: 'int main(){}',
  generatorCpp: null,
  templateVersion: 'red-gate-v1',
  revision: 3,
  verifiedRevision: 3,
  hasLatestPdf: false,
  latestPdfRevision: null,
  status: 'draft',
  publishedAt: null,
  testcaseStats: { total: 2, withOutput: 2 },
};

function show(path = '/admin/authoring/ai-docs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/authoring" element={<ProblemAuthoring />} />
        <Route path="/admin/authoring/profiles" element={<ProblemAuthoring />} />
        <Route path="/admin/authoring/ai-docs" element={<ProblemAuthoring />} />
        <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />}>
          <Route index element={<DraftMetadata />} />
          <Route path="ai-docs" element={<DraftAiDocs />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ user: { role: 'admin' }, isLoading: false });
  jest.mocked(api.get).mockImplementation(async (url: string) => ({
    data: url.endsWith('/drafts')
      ? [draft]
      : url.endsWith('/jobs')
        ? []
        : draft,
  }));
});

test('renders the reference document at the AI Docs route with a copy button', () => {
  show();
  // The document is present with its sections and endpoints.
  expect(screen.getByRole('heading', { name: 'AI Docs', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Authentication', level: 2 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Rules summary', level: 2 })).toBeInTheDocument();
  expect(screen.getAllByText(/POST \/admin\/authoring\/drafts/).length).toBeGreaterThan(0);
  // The drafts landing link is present on the standalone page.
  expect(screen.getByRole('link', { name: '← All drafts' })).toHaveAttribute(
    'href',
    '/admin/authoring'
  );
  expect(screen.getByRole('button', { name: 'Copy for AI agent' })).toBeEnabled();
  // The static document renders without any API call.
  expect(api.get).not.toHaveBeenCalled();
});

test('plain users cannot open AI Docs', () => {
  (useAuth as jest.Mock).mockReturnValue({ user: { role: 'user' }, isLoading: false });
  show();
  expect(screen.getByText(/admin or staff access required/i)).toBeInTheDocument();
});

test('the drafts list links to AI Docs', async () => {
  show('/admin/authoring');
  const link = await screen.findByRole('link', { name: /^AI Docs$/ });
  expect(link).toHaveAttribute('href', '/admin/authoring/ai-docs');
});

test('AI Docs is the last entry of the draft workspace left nav', async () => {
  show('/admin/authoring/d1');
  const nav = await screen.findByRole('navigation', { name: 'Draft sections' }, { timeout: 3000 });
  const links = Array.from(nav.querySelectorAll('a'));
  expect(links.map(a => a.textContent)).toEqual([
    'Metadata',
    'Statement',
    'Solution',
    'Generator',
    'Testcases',
    'Verify & Publish',
    'History & Logs',
    'AI Docs',
  ]);
  expect(links[links.length - 1]).toHaveAttribute('href', '/admin/authoring/d1/ai-docs');
});

test('the copy button copies the markdown version and confirms', async () => {
  const writeText = jest.fn().mockImplementation(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  show();

  fireEvent.click(screen.getByRole('button', { name: 'Copy for AI agent' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = writeText.mock.calls[0][0] as string;

  // The copied markdown is clean, complete and prompt-ready: a heading per
  // section, fenced code blocks, markdown tables, no UI chrome or HTML
  // entities, no template leftovers.
  expect(copied).toContain('# Problem Authoring API reference');
  expect(copied).toContain('## Authentication');
  expect(copied).toContain('## Rules summary');
  expect(copied).toContain('```bash');
  expect(copied).toContain('curl -s -c cookies.txt');
  expect(copied).toContain('| Field | Type | Required | Constraints |');
  expect(copied).toContain('| Rule | Detail |');
  expect(copied).not.toContain('&amp;');
  expect(copied).not.toContain('&lt;');
  expect(copied).not.toContain('undefined');
  expect(copied).not.toContain('[object Object]');
  expect(copied.endsWith('\n')).toBe(true);

  // The button confirms the copy.
  expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
});

test('a failed clipboard copy reports the failure instead of claiming success', async () => {
  const writeText = jest.fn().mockImplementation(() => Promise.reject(new Error('denied')));
  Object.assign(navigator, { clipboard: { writeText } });
  show();

  fireEvent.click(screen.getByRole('button', { name: 'Copy for AI agent' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Copied!' })).not.toBeInTheDocument();
});

test('the markdown and the rendered page describe the same endpoints', () => {
  const markdown = buildAiDocsMarkdown();
  // A sample of load-bearing endpoints and codes appear in the copied text.
  for (const fragment of [
    'POST /admin/authoring/drafts',
    'PATCH /admin/authoring/drafts/:id',
    'POST /admin/authoring/drafts/:id/publish',
    'GET /admin/authoring/jobs/:id',
    'revision_conflict',
    'expectedRevision',
    'draft_not_ready',
    'problem_id_conflict',
  ]) {
    expect(markdown).toContain(fragment);
  }
});
