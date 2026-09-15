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
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/admin/authoring" element={<ProblemAuthoring />} />
    <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  jest.resetAllMocks();
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
  fireEvent.click(await screen.findByRole('tab', { name: 'Statement' }));
  fireEvent.change(screen.getByLabelText('Statement HTML / LaTeX'), { target: { value: '<p>Edited</p>' } });
  expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Build PDF' })).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Solution' }));
  expect(screen.getByRole('button', { name: 'Compile solution' })).toBeDisabled();
  jest.mocked(api.patch).mockResolvedValue({ data: { ...draft, statementHtml: '<p>Edited</p>', revision: 4, status: 'draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Compile solution' })).toBeEnabled());
  fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));
  expect(screen.getByLabelText('Statement HTML / LaTeX')).toHaveValue('<p>Edited</p>');
});
test('fast preview uses server-sanitized HTML in an opaque-origin sandbox, not the editor source', async () => {
  show('/admin/authoring/d1');
  fireEvent.click(await screen.findByRole('tab', { name: 'Statement' }));
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Sanitized preview</p>' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview HTML' }));
  const frame = await screen.findByTitle('Fast statement preview');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('srcdoc', '<p>Sanitized preview</p>');
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
