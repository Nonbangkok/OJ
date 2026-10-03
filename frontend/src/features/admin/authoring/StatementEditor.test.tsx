import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useAuthoringDraft from './useAuthoringDraft';
import StatementEditor from './StatementEditor';

jest.mock('./useAuthoringDraft');

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

afterEach(() => jest.clearAllMocks());

test('source remains editable while autosave is pending', () => {
  mockedUseAuthoringDraft.mockReturnValue(model() as ReturnType<typeof useAuthoringDraft>);

  render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);

  expect(screen.getByRole('textbox', { name: 'Statement source' })).not.toHaveAttribute('readonly');
});

test('source locks while an authoring job is active', () => {
  mockedUseAuthoringDraft.mockReturnValue(model({ id: 'j1', jobType: 'pdf', status: 'running' }) as ReturnType<typeof useAuthoringDraft>);

  render(<MemoryRouter><StatementEditor id="d1" /></MemoryRouter>);

  expect(screen.getByRole('textbox', { name: 'Statement source' })).toHaveAttribute('readonly');
});
