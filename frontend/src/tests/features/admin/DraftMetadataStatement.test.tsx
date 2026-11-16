import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import useStatementPreview from '../../../features/admin/authoring/useStatementPreview';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
import { DraftMetadata, DraftStatement } from '../../../features/admin/authoring/DraftWorkspace';

jest.mock('../../../services/api');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../hooks/useMediaQuery', () => ({ useMediaQuery: jest.fn() }));
jest.mock('../../../features/admin/authoring/useStatementPreview', () => ({ __esModule: true, default: jest.fn() }));

const base = {
  id: 'd1', problemId: 'hp_graph_bfs', title: 'Shortest hops', authorProfileId: null, authorAkaName: 'Ada', authorRealName: 'Ada L',
  language: 'Thai', countryCode: 'THA', categories: ['Graph'], difficulty: 1600, timeLimitMs: 1000, memoryLimitMb: 256,
  statementHtml: '<p>Find the fewest roads.</p>', solutionCpp: 'int main(){}', generatorCpp: null, templateVersion: 'red-gate-v1',
  revision: 14, verifiedRevision: null, hasLatestPdf: true, latestPdfRevision: 12, status: 'generated', publishedAt: null,
  hasAuthorProfileImage: false, updatedAt: '2026-11-16T00:00:00Z', testcaseStats: { total: 2, withOutput: 2 },
};
let draft: Record<string, unknown> = base;
const assets = [{ id: 'a1', filename: 'graph.png', sizeBytes: 84_000 }];
const serve = () => jest.mocked(api.get).mockImplementation(async (url: string) => ({
  data: url.endsWith('/jobs') ? [] : url.endsWith('/assets') ? assets : url.endsWith('/testcases') ? { revision: 14, testcases: [] } : url.endsWith('/d1') ? draft : [],
}));
const show = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />}>
        <Route index element={<DraftMetadata />} />
        <Route path="metadata" element={<DraftMetadata />} />
        <Route path="statement" element={<DraftStatement />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe('Metadata and Statement tabs (§7.9)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.sessionStorage.clear();
    jest.mocked(useMediaQuery).mockReturnValue(false);
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'staff' }, isLoading: false } as ReturnType<typeof useAuth>);
    jest.mocked(useStatementPreview).mockReturnValue({ html: '<p>Find the fewest roads.</p>', state: 'ready', error: '', shell: '<html><body><div id="statement"></div></body></html>' });
    draft = base;
    serve();
  });

  it('Metadata: units on the limits, the XP hint, and categories as toggle chips', async () => {
    show('/admin/authoring/d1/metadata');
    expect(await screen.findByLabelText('Time limit')).toHaveValue(1000);
    expect(screen.getByText('ms')).toBeInTheDocument();
    expect(screen.getByLabelText('Memory limit')).toHaveValue(256);
    expect(screen.getByText('MB')).toBeInTheDocument();
    expect(screen.getByText('800–3500 · a first solve gives +57 XP')).toBeInTheDocument();
    expect(screen.getByText('Locked after the first publish.')).toBeInTheDocument();
    const graph = screen.getByRole('button', { name: 'Graph' });
    expect(graph).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Math' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Math' }));
    expect(screen.getByRole('button', { name: 'Math' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Metadata: a field error shows under its field', async () => {
    show('/admin/authoring/d1/metadata');
    fireEvent.change(await screen.findByLabelText('Memory limit'), { target: { value: '0' } });
    expect(screen.getByText('At least 1 MB.')).toBeInTheDocument();
    expect(screen.getByLabelText('Memory limit')).toHaveAttribute('aria-invalid', 'true');
  });

  it('Statement: the rendered statement, an Edit statement link, and the PDF row', async () => {
    show('/admin/authoring/d1/statement');
    expect(await screen.findByTitle('Live statement preview')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit statement' })).toHaveAttribute('href', '/admin/authoring/d1/editor');
    expect(screen.getByText(/PDF rev 12/)).toBeInTheDocument();
    expect(screen.getByText('older than the draft (rev 14)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', expect.stringContaining('/pdf'));
    jest.mocked(api.post).mockResolvedValue({ data: { id: 'j9', draftId: 'd1', draftRevision: 14, jobType: 'build_pdf', status: 'queued', createdAt: '', errorCode: null, errorMessage: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/pdf$/), expect.anything()));
  });

  it('Statement: no PDF yet offers Build PDF', async () => {
    draft = { ...base, hasLatestPdf: false, latestPdfRevision: null };
    serve();
    show('/admin/authoring/d1/statement');
    expect(await screen.findByText('No PDF yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build PDF' })).toBeInTheDocument();
  });

  it('Statement: images are a FileDrop and a table with the path to use and a delete behind a confirm', async () => {
    const user = userEvent.setup({ delay: 20 });
    show('/admin/authoring/d1/statement');
    const table = await screen.findByRole('table', { name: 'Statement images' });
    const row = within(table).getByText('graph.png').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('{{ASSET_BASE}}/graph.png');
    expect(row).toHaveTextContent('84 kB');
    expect(screen.getByText(/Drop images here/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Actions for graph.png' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete graph.png?' });
    jest.mocked(api.delete).mockResolvedValue({ data: {} });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(expect.stringContaining('/assets/a1'), expect.anything()));
  });

  it('final review: dropping several images uploads every one, each against the latest revision', async () => {
    let revision = 14;
    jest.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url.endsWith('/jobs') ? [] : url.endsWith('/assets') ? assets : url.endsWith('/testcases') ? { revision, testcases: [] }
        : url.endsWith('/d1') ? { ...base, revision } : [],
    }));
    jest.mocked(api.post).mockImplementation(async () => { revision += 1; return { data: {} }; });
    const { container } = show('/admin/authoring/d1/statement');
    await screen.findByRole('table', { name: 'Statement images' });
    const files = ['a.png', 'b.png', 'c.png'].map((name) => new File(['x'], name, { type: 'image/png' }));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files } });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    const sent = jest.mocked(api.post).mock.calls.map(([, body]) => (body as FormData).get('expectedRevision'));
    expect(sent).toEqual(['14', '15', '16']);
  });

  it('phone: Statement is read-only with a large-screen notice; Metadata stays editable', async () => {
    jest.mocked(useMediaQuery).mockReturnValue(true);
    show('/admin/authoring/d1/statement');
    expect(await screen.findByText('Best edited on a larger screen')).toBeInTheDocument();
    expect(screen.queryByText(/Drop images here/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit statement' })).toBeNull();
  });
});
