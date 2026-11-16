import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import useAuthoringDraft from './useAuthoringDraft';
import useStatementPreview from './useStatementPreview';
import StatementEditor from './StatementEditor';

jest.mock('./useAuthoringDraft');
jest.mock('./useStatementPreview', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../hooks/useMediaQuery', () => ({ useMediaQuery: jest.fn() }));

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
  return render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
};
const getSeparator = () => screen.getByRole('separator', { name: 'Resize source and preview panes' });

describe('statement editor layout', () => {
  let spies: jest.SpyInstance[] = [];
  beforeEach(() => {
    window.localStorage.clear();
    // jsdom does no layout; the panel library refuses keyboard resizes while the group measures 0px.
    spies = [
      jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
        { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON: () => ({}) }),
      jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400),
      jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400),
    ];
  });
  afterEach(() => spies.forEach(spy => spy.mockRestore()));

  test('statement editor splits source and preview 50/50 by default', () => {
    renderEditor();

    expect(getSeparator()).toHaveAttribute('aria-valuenow', '50');
  });

  test('double-clicking the pane divider resets the split to 50/50', () => {
    renderEditor();
    const separator = getSeparator();

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).not.toHaveAttribute('aria-valuenow', '50');
    fireEvent.doubleClick(separator);

    expect(separator).toHaveAttribute('aria-valuenow', '50');
  });

  test('divider keeps its accessible name', () => {
    renderEditor();

    expect(getSeparator()).toBeInTheDocument();
  });

  test('panes stop at 25 percent', () => {
    renderEditor();
    const separator = getSeparator();

    fireEvent.keyDown(separator, { key: 'Home' });

    expect(separator).toHaveAttribute('aria-valuenow', '25');
    expect(separator).toHaveAttribute('aria-valuemin', '25');
  });

  test('remembers the split per draft', () => {
    const { unmount } = renderEditor();
    fireEvent.keyDown(getSeparator(), { key: 'ArrowRight' });
    const moved = getSeparator().getAttribute('aria-valuenow');
    expect(moved).not.toBe('50');
    unmount();

    renderEditor();

    expect(getSeparator()).toHaveAttribute('aria-valuenow', moved);
  });

  test('marks the workspace as resizing from divider press until pointer release', () => {
    renderEditor();
    const region = screen.getByRole('region', { name: 'Statement editor' });
    expect(region.className).not.toContain('editorWorkspaceResizing');

    fireEvent.pointerDown(getSeparator());
    expect(region.className).toContain('editorWorkspaceResizing');

    fireEvent.pointerUp(window);
    expect(region.className).not.toContain('editorWorkspaceResizing');
  });

  test('ignores a corrupt saved layout', () => {
    window.localStorage.setItem('react-resizable-panels:oj-authoring-statement-layout:d1', 'not json{');

    renderEditor();

    expect(getSeparator()).toHaveAttribute('aria-valuenow', '50');
  });
});

test('Ctrl+S calls the save of the latest render, not the first one', () => {
  mockedUseStatementPreview.mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
  const first = model();
  mockedUseAuthoringDraft.mockReturnValue(first as unknown as ReturnType<typeof useAuthoringDraft>);
  const { rerender } = render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
  const second = model();
  mockedUseAuthoringDraft.mockReturnValue(second as unknown as ReturnType<typeof useAuthoringDraft>);
  rerender(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);

  fireEvent.keyDown(window, { key: 's', ctrlKey: true });

  expect(first.save).not.toHaveBeenCalled();
  expect(second.save).toHaveBeenCalledTimes(1);
});

test('the Actual PDF embed keeps the loaded revision while a build runs, then swaps once', () => {
  mockedUseStatementPreview.mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
  const withPdf = (latestPdfRevision: number, activeJob?: { id: string; jobType: string; status: string }) => {
    const pdfDraft = { ...draft, hasLatestPdf: true, latestPdfRevision };
    return { ...model(activeJob), draft: pdfDraft, form: pdfDraft } as unknown as ReturnType<typeof useAuthoringDraft>;
  };
  const job = { id: 'j1', jobType: 'pdf', status: 'running' };
  mockedUseAuthoringDraft.mockReturnValue(withPdf(2, job));
  const { rerender } = render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
  fireEvent.click(within(screen.getByRole('group', { name: 'Preview mode' })).getByRole('button', { name: 'PDF' }));
  const pdfFrame = () => screen.getByTitle('Latest runner-built PDF');
  expect(pdfFrame().getAttribute('src')).toContain('revision=2');
  const loaded = pdfFrame();

  mockedUseAuthoringDraft.mockReturnValue(withPdf(3, job));
  rerender(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
  expect(pdfFrame()).toBe(loaded);
  expect(pdfFrame().getAttribute('src')).toContain('revision=2');

  mockedUseAuthoringDraft.mockReturnValue(withPdf(3));
  rerender(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
  expect(pdfFrame()).not.toBe(loaded);
  expect(pdfFrame().getAttribute('src')).toContain('revision=3');
});

describe('full-screen editor chrome (§7.9)', () => {
  const showWith = (over: { draftOver?: Record<string, unknown>; [key: string]: unknown } = {}) => {
    const { draftOver, ...rest } = over;
    const d = { ...draft, ...draftOver };
    mockedUseAuthoringDraft.mockReturnValue({ ...model(), draft: d, form: d, ...rest } as unknown as ReturnType<typeof useAuthoringDraft>);
    mockedUseStatementPreview.mockReturnValue({ html: '', state: 'waiting', error: '', shell: '' });
    return render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
  };
  const idle = { busy: false, dirty: false, saveState: 'saved', actionsDisabled: false };

  test('the top bar: back to the workspace, the title and the save state', () => {
    showWith(idle);
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('link', { name: '← Workspace' })).toHaveAttribute('href', '/admin/authoring/d1');
    expect(within(bar).getByRole('heading', { level: 1 })).toHaveTextContent('Sum');
    expect(within(bar).getByText('Saved · rev 3')).toBeInTheDocument();
    expect(within(bar).getByText(/(⌘S|Ctrl\+S) save/)).toBeInTheDocument();
    expect(within(bar).queryByText('Published · live unchanged')).toBeNull();
  });

  test('save state reads Saving… and Unsaved', () => {
    const { unmount } = showWith();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    unmount();
    showWith({ busy: false, saveState: 'dirty' });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  test('minor: under a server conflict the editor save state reads Unsaved', () => {
    showWith({ ...idle, conflict: true, dirty: true, saveState: 'dirty' });
    expect(within(screen.getByRole('banner')).getByText('Unsaved')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).queryByText('Server state changed')).toBeNull();
  });

  test('a published draft carries the "live unchanged" badge', () => {
    showWith({ ...idle, draftOver: { status: 'published', publishedAt: '2026-11-10T00:00:00Z' } });
    expect(screen.getByText('Published · live unchanged')).toBeInTheDocument();
  });

  test('Preview / PDF segment and − Fit + zoom, Fit by default', () => {
    window.localStorage.clear();
    showWith(idle);
    const mode = screen.getByRole('group', { name: 'Preview mode' });
    expect(within(mode).getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(mode).getByRole('button', { name: 'PDF' })).toHaveAttribute('aria-pressed', 'false');
    const fit = screen.getByRole('button', { name: 'Fit to width' });
    expect(fit).toHaveTextContent('Fit');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(fit).toHaveTextContent('110%');
    fireEvent.click(fit);
    expect(fit).toHaveTextContent('Fit');
  });

  test('the source is the shared code editor with HTML highlighting', () => {
    const { container } = showWith({ ...idle, draftOver: { statementHtml: '<p>Sum</p>' } });
    expect(screen.getByRole('textbox', { name: 'Statement source' })).toHaveValue('<p>Sum</p>');
    expect(container.querySelector('.hljs-tag')).not.toBeNull();
  });

  test('a stale PDF says which revision it is from and builds it', () => {
    const runJob = jest.fn();
    showWith({ ...idle, runJob, draftOver: { hasLatestPdf: true, latestPdfRevision: 2 } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Preview mode' })).getByRole('button', { name: 'PDF' }));
    expect(screen.getByText('PDF is from rev 2')).toBeInTheDocument();
    // The existing auto-build on switching to a stale PDF is kept.
    expect(runJob).toHaveBeenCalledWith('pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Build PDF now' }));
    expect(runJob).toHaveBeenCalledTimes(2);
  });

  test('final review: on a phone, a stale PDF builds only while the Preview pane is showing', () => {
    jest.mocked(useMediaQuery).mockReturnValue(true);
    const runJob = jest.fn();
    const { rerender } = showWith({ ...idle, runJob, draftOver: { hasLatestPdf: true, latestPdfRevision: 2 } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Editor pane' })).getByRole('button', { name: 'Preview' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Preview mode' })).getByRole('button', { name: 'PDF' }));
    expect(runJob).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('group', { name: 'Editor pane' })).getByRole('button', { name: 'Source' }));
    runJob.mockClear();
    // A new stale state (the next autosave) while the author is typing in Source.
    const d = { ...draft, hasLatestPdf: true, latestPdfRevision: 2, revision: 4 };
    mockedUseAuthoringDraft.mockReturnValue({ ...model(), ...idle, runJob, draft: d, form: d } as unknown as ReturnType<typeof useAuthoringDraft>);
    rerender(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);
    expect(screen.getByRole('textbox', { name: 'Statement source' })).toBeInTheDocument();
    expect(runJob).not.toHaveBeenCalled();
  });

  test('below 768 px: Source / Preview tabs instead of the split', () => {
    jest.mocked(useMediaQuery).mockReturnValue(true);
    showWith(idle);
    expect(screen.queryByRole('separator', { name: 'Resize source and preview panes' })).toBeNull();
    const panes = screen.getByRole('group', { name: 'Editor pane' });
    expect(within(panes).getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Statement source' })).toBeInTheDocument();
    fireEvent.click(within(panes).getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('textbox', { name: 'Statement source' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Preview mode' })).toBeInTheDocument();
  });
});
