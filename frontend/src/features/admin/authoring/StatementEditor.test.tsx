import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useAuthoringDraft from './useAuthoringDraft';
import useStatementPreview from './useStatementPreview';
import StatementEditor from './StatementEditor';

jest.mock('./useAuthoringDraft');
jest.mock('./useStatementPreview', () => ({ __esModule: true, default: jest.fn() }));

const draft = {
  id: 'd1', problemId: 'sum', title: 'Sum', authorProfileId: null, authorAkaName: 'AKA',
  authorRealName: 'Author', language: 'Thai', countryCode: 'THA', timeLimitMs: 1000,
  memoryLimitMb: 256, statementHtml: '# Sum', solutionCpp: 'int main(){}', generatorCpp: null,
  templateVersion: 'red-gate-v1', revision: 3, verifiedRevision: 3, hasLatestPdf: false,
  latestPdfRevision: null, status: 'draft', publishedAt: null,
};

const model = (activeJob?: { id: string; jobType: string; status: string }) => ({
  draft, form: draft, jobs: [], busy: true, dirty: true, error: '', conflict: false, loaded: true,
  activeJob, actionsDisabled: true, canPublish: false, saveState: 'saving' as const, recovered: false,
  edit: jest.fn(), restoreStatement: jest.fn(), save: jest.fn(), refresh: jest.fn(),
  discardAndRefresh: jest.fn(), mutate: jest.fn(), runJob: jest.fn(), publish: jest.fn(),
  onError: jest.fn(), setOperationBusy: jest.fn(),
});

const mockedUseAuthoringDraft = jest.mocked(useAuthoringDraft);
const mockedUseStatementPreview = jest.mocked(useStatementPreview);

afterEach(() => jest.clearAllMocks());

test('source remains editable while autosave is pending', () => {
  mockedUseAuthoringDraft.mockReturnValue(model() as unknown as ReturnType<typeof useAuthoringDraft>);
  mockedUseStatementPreview.mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });

  render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);

  expect(screen.getByRole('textbox', { name: 'Statement source' })).not.toHaveAttribute('readonly');
});

test('source locks while an authoring job is active', () => {
  mockedUseAuthoringDraft.mockReturnValue(model({ id: 'j1', jobType: 'pdf', status: 'running' }) as unknown as ReturnType<typeof useAuthoringDraft>);
  mockedUseStatementPreview.mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });

  render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);

  expect(screen.getByRole('textbox', { name: 'Statement source' })).toHaveAttribute('readonly');
});

test('keeps source writable and visible when local preview reports an error', () => {
  mockedUseAuthoringDraft.mockReturnValue(model() as unknown as ReturnType<typeof useAuthoringDraft>);
  mockedUseStatementPreview.mockReturnValue({ html: '', state: 'error', error: 'Invalid statement markup', shell: '' });

  render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);

  expect(screen.getByRole('textbox', { name: 'Statement source' })).toHaveValue('# Sum');
  expect(screen.getByRole('textbox', { name: 'Statement source' })).not.toHaveAttribute('readonly');
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid statement markup');
});

test('shows a clear loading state in the preview viewport', () => {
  mockedUseAuthoringDraft.mockReturnValue(model() as unknown as ReturnType<typeof useAuthoringDraft>);
  mockedUseStatementPreview.mockReturnValue({ html: '', state: 'loading', error: '', shell: '' });

  render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);

  expect(screen.getAllByText('Rendering live preview…')).toHaveLength(2);
  expect(screen.queryByText('Preview will appear here.')).not.toBeInTheDocument();
});

const renderEditor = () => {
  mockedUseAuthoringDraft.mockReturnValue(model() as unknown as ReturnType<typeof useAuthoringDraft>);
  mockedUseStatementPreview.mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
  render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
};

test('statement editor splits source and preview 50/50 by default', () => {
  renderEditor();

  expect(screen.getByRole('separator', { name: 'Resize source and preview panes' })).toHaveAttribute('aria-valuenow', '50');
});

test('double-clicking the pane divider resets the split to 50/50', () => {
  // jsdom does no layout; the panel library refuses keyboard resizes while the group measures 0px.
  const rect = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON: () => ({}) });
  const width = jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
  const height = jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
  renderEditor();
  const separator = screen.getByRole('separator', { name: 'Resize source and preview panes' });

  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  expect(separator).not.toHaveAttribute('aria-valuenow', '50');
  fireEvent.doubleClick(separator);

  expect(separator).toHaveAttribute('aria-valuenow', '50');
  [rect, width, height].forEach(spy => spy.mockRestore());
});

test('divider keeps its accessible name', () => {
  renderEditor();

  expect(screen.getByRole('separator', { name: 'Resize source and preview panes' })).toBeInTheDocument();
});
