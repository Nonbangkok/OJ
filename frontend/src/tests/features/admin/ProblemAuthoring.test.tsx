import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
jest.mock('../../../services/api');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
const draft = { id: 'd1', problemId: 'sum', title: 'Sum', authorProfileId: null,
  authorAkaName: 'AKA', authorRealName: 'Author', language: 'Thai', countryCode: 'THA',
  timeLimitMs: 1000, memoryLimitMb: 256, statementHtml: '<p>Sum</p>', solutionCpp: 'int main(){}',
  generatorCpp: null, templateVersion: 'red-gate-v1', revision: 3, verifiedRevision: 3,
  hasLatestPdf: false, latestPdfRevision: null, status: 'ready' };
function show(path = '/admin/authoring') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/admin/authoring" element={<ProblemAuthoring />} />
    <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />} />
    <Route path="/admin/authoring/:draftId/editor" element={<ProblemAuthoring editorMode />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  jest.resetAllMocks();
  window.sessionStorage.clear();
  (useAuth as jest.Mock).mockReturnValue({ user: { role: 'admin' }, isLoading: false });
  jest.mocked(api.get).mockImplementation(async url => ({ data:
    url.endsWith('/drafts') ? [draft] : url.endsWith('/testcases') ? { revision: 3, testcases: [] }
      : url.endsWith('/d1') ? draft : [] }));
});
test('staff cannot load private authoring data even through a direct URL', () => {
  (useAuth as jest.Mock).mockReturnValue({ user: { role: 'staff' }, isLoading: false });
  show('/admin/authoring/d1');
  expect(screen.getByText(/admin access required/i)).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});
test('lists resumable drafts and creates a draft with explicit author metadata', async () => {
  show();
  expect(await screen.findByRole('link', { name: /sum/i })).toHaveAttribute('href', '/admin/authoring/d1');
  fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
  fireEvent.change(screen.getByLabelText('Problem ID'), { target: { value: 'new' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New problem' } });
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'Writer' } });
  fireEvent.change(screen.getByLabelText('Real name'), { target: { value: 'Name' } });
  jest.mocked(api.post).mockResolvedValue({ data: draft });
  fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/authoring/drafts', expect.objectContaining({
    problemId: 'new', title: 'New problem', authorAkaName: 'Writer', authorRealName: 'Name', generatorCpp: null,
  })));
  expect(await screen.findByRole('tab', { name: 'Statement' })).toBeInTheDocument();
});
test('tabs preserve edits and disable job actions until explicit Save succeeds', async () => {
  show('/admin/authoring/d1');
  fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Edited title' } });
  expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));
  expect(screen.getByRole('button', { name: 'Build PDF' })).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Solution' }));
  expect(screen.getByRole('button', { name: 'Compile solution' })).toBeDisabled();
  jest.mocked(api.patch).mockResolvedValue({ data: { ...draft, title: 'Edited title', revision: 4, status: 'draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Compile solution' })).toBeEnabled());
});
test('Statement tab opens the dedicated editor instead of embedding a narrow source textarea', async () => {
  show('/admin/authoring/d1');
  fireEvent.click(await screen.findByRole('tab', { name: 'Statement' }));
  expect(screen.getByRole('link', { name: 'Open full-screen editor' }))
    .toHaveAttribute('href', '/admin/authoring/d1/editor');
  expect(screen.queryByLabelText('Statement Markdown / HTML / LaTeX')).not.toBeInTheDocument();
});
test('opening the dedicated editor cannot silently discard unsaved workspace fields', async () => {
  show('/admin/authoring/d1');
  fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Unsaved title' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);

  fireEvent.click(screen.getByRole('link', { name: 'Open full-screen editor' }));

  expect(confirm).toHaveBeenCalledWith('Leave without saving your draft changes?');
  expect(screen.queryByLabelText('Statement Markdown / HTML / LaTeX')).not.toBeInTheDocument();
  confirm.mockRestore();
});
test('unsaved statement source survives an editor route unmount such as browser Back and Forward', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  const view = show('/admin/authoring/d1/editor');
  fireEvent.change(await screen.findByLabelText('Statement Markdown / HTML / LaTeX'),
    { target: { value: '# Recovered work' } });

  view.unmount();
  show('/admin/authoring/d1/editor');

  await waitFor(() => expect(screen.getByLabelText('Statement Markdown / HTML / LaTeX'))
    .toHaveValue('# Recovered work'));
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
});
test('editing recovered source preserves its old base revision across another route unmount', async () => {
  let serverDraft = draft;
  jest.mocked(api.get).mockImplementation(async url => ({ data:
    url.endsWith('/jobs') || url.endsWith('/assets') ? []
      : url.endsWith('/testcases') ? { revision: serverDraft.revision, testcases: [] }
      : serverDraft }));
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  const first = show('/admin/authoring/d1/editor');
  fireEvent.change(await screen.findByLabelText('Statement Markdown / HTML / LaTeX'),
    { target: { value: '# Revision 3 work' } });
  first.unmount();

  serverDraft = { ...draft, revision: 4, statementHtml: '# Server revision 4' };
  const second = show('/admin/authoring/d1/editor');
  await waitFor(() => expect(screen.getByText(/server state changed/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Statement Markdown / HTML / LaTeX'),
    { target: { value: '# Revision 3 work continued' } });
  second.unmount();

  show('/admin/authoring/d1/editor');
  await waitFor(() => expect(screen.getByLabelText('Statement Markdown / HTML / LaTeX'))
    .toHaveValue('# Revision 3 work continued'));
  expect(screen.getByText(/server state changed/i)).toBeInTheDocument();
});
test('a new edit after clean auto-sync uses the refreshed server revision as its recovery base', async () => {
  let serverDraft = draft;
  jest.mocked(api.get).mockImplementation(async url => ({ data:
    url.endsWith('/jobs') || url.endsWith('/assets') ? [] : serverDraft }));
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  const first = show('/admin/authoring/d1/editor');
  await screen.findByLabelText('Statement Markdown / HTML / LaTeX');
  serverDraft = { ...draft, revision: 4, statementHtml: '# Server revision 4' };
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByLabelText('Statement Markdown / HTML / LaTeX'))
    .toHaveValue('# Server revision 4'));
  fireEvent.change(screen.getByLabelText('Statement Markdown / HTML / LaTeX'),
    { target: { value: '# New work based on revision 4' } });
  first.unmount();

  show('/admin/authoring/d1/editor');
  await waitFor(() => expect(screen.getByLabelText('Statement Markdown / HTML / LaTeX'))
    .toHaveValue('# New work based on revision 4'));
  expect(screen.queryByText(/server state changed/i)).not.toBeInTheDocument();
});
test('full-screen editor previews the current unsaved source automatically in a sandbox', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Sanitized preview</p>' } });
  show('/admin/authoring/d1/editor');
  const source = await screen.findByLabelText('Statement Markdown / HTML / LaTeX');
  expect(screen.queryByRole('button', { name: 'Preview statement' })).not.toBeInTheDocument();
  const frame = await screen.findByTitle('Fast statement preview');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('srcdoc', '<p>Sanitized preview</p>');
  fireEvent.change(source, { target: { value: '# Live edit' } });
  expect(api.post).not.toHaveBeenCalledWith('/admin/authoring/drafts/d1/preview', { statementHtml: '# Live edit' });
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/authoring/drafts/d1/preview',
    { statementHtml: '# Live edit' }), { timeout: 1500 });
});
test('full-screen editor keeps a stable notices row so the workspace fills the remaining viewport', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  show('/admin/authoring/d1/editor');
  expect(await screen.findByRole('region', { name: 'Editor notices' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Statement editor' })).toBeInTheDocument();
});
test('a slower realtime preview response cannot replace the newest preview', async () => {
  let resolveFirst!: (value: any) => void; let resolveSecond!: (value: any) => void;
  jest.mocked(api.post).mockResolvedValueOnce({ data: { html: '<p>Initial</p>' } });
  show('/admin/authoring/d1/editor');
  const source = await screen.findByLabelText('Statement Markdown / HTML / LaTeX');
  const frame = await screen.findByTitle('Fast statement preview');
  jest.mocked(api.post)
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  fireEvent.change(source, { target: { value: '# First' } });
  await waitFor(() => expect(resolveFirst).toBeDefined(), { timeout: 1500 });
  fireEvent.change(source, { target: { value: '# Second' } });
  await waitFor(() => expect(resolveSecond).toBeDefined(), { timeout: 1500 });
  resolveSecond({ data: { html: '<p>Second</p>' } });
  await waitFor(() => expect(frame).toHaveAttribute('srcdoc', '<p>Second</p>'));
  resolveFirst({ data: { html: '<p>First</p>' } });
  await waitFor(() => expect(frame).toHaveAttribute('srcdoc', '<p>Second</p>'));
});
test('Publish requires explicit confirmation and explains hidden visibility', async () => {
  jest.mocked(api.get).mockImplementation(async url => ({ data: url.endsWith('/d1')
    ? { ...draft, hasLatestPdf: true, latestPdfRevision: 3 } : [] }));
  show('/admin/authoring/d1');
  fireEvent.click(await screen.findByRole('tab', { name: 'Verify & Publish' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish problem' }));
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByText(/created as hidden/i)).toBeInTheDocument();
  jest.mocked(api.post).mockResolvedValue({ data: { status: 'published' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Publish' }));
  expect(await screen.findByText(/published — read-only/i)).toBeInTheDocument();
});
