import { act, renderHook, waitFor } from '@testing-library/react';
import api from '../../../services/api';
import useAuthoringDraft from '../../../features/admin/authoring/useAuthoringDraft';

jest.mock('../../../services/api');
const draft = { id: 'd1', problemId: 'sum', title: 'Sum', authorProfileId: null,
  authorAkaName: 'AKA', authorRealName: 'Author', language: 'Thai', countryCode: 'THA',
  timeLimitMs: 1000, memoryLimitMb: 256, statementHtml: '<p>Sum</p>', solutionCpp: 'int main(){}',
  generatorCpp: null, templateVersion: 'red-gate-v1', revision: 3, verifiedRevision: 3,
  hasLatestPdf: true, latestPdfRevision: 3, status: 'ready' };
const job = { id: 'j1', draftId: 'd1', draftRevision: 3, jobType: 'verify_all', status: 'queued' };
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(api.get).mockImplementation(async url => ({ data: url.endsWith('/jobs') ? [] : draft }));
});

test('dirty edits disable actions, explicit Save sends only changed fields and the captured revision', async () => {
  const { result } = renderHook(() => useAuthoringDraft('d1'));
  await waitFor(() => expect(result.current.draft?.revision).toBe(3));
  act(() => result.current.edit('title', 'Changed'));
  expect(result.current.dirty).toBe(true);
  expect(result.current.actionsDisabled).toBe(true);
  jest.mocked(api.patch).mockResolvedValue({ data: { ...draft, title: 'Changed', revision: 4, status: 'draft', verifiedRevision: null } });
  await act(async () => { await result.current.save(); });
  expect(api.patch).toHaveBeenCalledWith('/admin/authoring/drafts/d1', { expectedRevision: 3, title: 'Changed' });
  expect(result.current.dirty).toBe(false);
  expect(result.current.draft?.revision).toBe(4);
});

test('a revision conflict keeps unsaved source and requires explicit reload, never auto retries', async () => {
  const { result } = renderHook(() => useAuthoringDraft('d1'));
  await waitFor(() => expect(result.current.draft).not.toBeNull());
  act(() => result.current.edit('statementHtml', '<p>My work</p>'));
  jest.mocked(api.patch).mockRejectedValue({ response: { status: 409, data: { code: 'revision_conflict', message: 'Revision conflict', currentRevision: 4 } } });
  await act(async () => { await result.current.save(); });
  expect(result.current.form?.statementHtml).toBe('<p>My work</p>');
  expect(result.current.dirty).toBe(true);
  expect(result.current.conflict).toBe(true);
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(result.current.actionsDisabled).toBe(true);
});

test('resuming an active durable job disables mutations and polling refreshes completed artifacts', async () => {
  let finished = false;
  jest.mocked(api.get).mockImplementation(async url => ({ data: url.endsWith('/jobs')
    ? [{ ...job, status: finished ? 'succeeded' : 'running' }]
    : { ...draft, status: finished ? 'ready' : 'draft' } }));
  const { result } = renderHook(() => useAuthoringDraft('d1', 20));
  await waitFor(() => expect(result.current.activeJob?.id).toBe('j1'));
  expect(result.current.actionsDisabled).toBe(true);
  finished = true;
  await waitFor(() => expect(result.current.draft?.status).toBe('ready'));
  expect(result.current.activeJob).toBeUndefined();
  expect(result.current.canPublish).toBe(true);
});

test('an idle draft stops polling after its initial snapshot', async () => {
  const { result } = renderHook(() => useAuthoringDraft('d1', 20));
  await waitFor(() => expect(result.current.draft?.revision).toBe(3));
  expect(api.get).toHaveBeenCalledTimes(2);

  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });

  expect(api.get).toHaveBeenCalledTimes(2);
});

test('queued Verify immediately disables Publish and sends exact revision without source overrides', async () => {
  const { result } = renderHook(() => useAuthoringDraft('d1'));
  await waitFor(() => expect(result.current.canPublish).toBe(true));
  jest.mocked(api.post).mockResolvedValue({ data: job });
  await act(async () => { await result.current.runJob('verify'); });
  expect(api.post).toHaveBeenCalledWith('/admin/authoring/drafts/d1/jobs/verify', { expectedRevision: 3 });
  expect(result.current.activeJob?.id).toBe('j1');
  expect(result.current.canPublish).toBe(false);
});

test('published and dirty drafts cannot invoke jobs or Publish even through handlers', async () => {
  jest.mocked(api.get).mockImplementation(async url => ({ data: url.endsWith('/jobs') ? [] : { ...draft, status: 'published' } }));
  const { result } = renderHook(() => useAuthoringDraft('d1'));
  await waitFor(() => expect(result.current.draft?.status).toBe('published'));
  await act(async () => { await result.current.runJob('pdf'); await result.current.publish(); });
  expect(api.post).not.toHaveBeenCalled();
  expect(result.current.actionsDisabled).toBe(true);
});

test('Publish updates the draft to read-only, with no visibility override', async () => {
  const { result } = renderHook(() => useAuthoringDraft('d1'));
  await waitFor(() => expect(result.current.canPublish).toBe(true));
  jest.mocked(api.post).mockResolvedValue({ data: { status: 'published', isVisible: false } });
  await act(async () => { await result.current.publish(); });
  expect(api.post).toHaveBeenCalledWith('/admin/authoring/drafts/d1/publish', { expectedRevision: 3 });
  expect(result.current.draft?.status).toBe('published');
  expect(result.current.actionsDisabled).toBe(true);
});

test('a slow refresh started before Save cannot restore an older server revision', async () => {
  let resolveOld: (value: unknown) => void;
  const { result } = renderHook(() => useAuthoringDraft('d1'));
  await waitFor(() => expect(result.current.draft).not.toBeNull());
  jest.mocked(api.get).mockImplementation(url => url.endsWith('/jobs') ? Promise.resolve({ data: [] })
    : new Promise(resolve => { resolveOld = resolve; }));
  let pendingRefresh: Promise<void>;
  act(() => { pendingRefresh = result.current.refresh(); });
  await waitFor(() => expect(resolveOld).toBeDefined());
  act(() => result.current.edit('title', 'Changed'));
  jest.mocked(api.patch).mockResolvedValue({ data: { ...draft, title: 'Changed', revision: 4 } });
  await act(async () => { await result.current.save(); });
  await act(async () => {
    if (!resolveOld) throw new Error('Expected the slow poll request to start');
    resolveOld({ data: draft });
    await pendingRefresh;
  });
  expect(result.current.form?.title).toBe('Changed');
  expect(result.current.draft?.revision).toBe(4);
});

test('refresh after an external file change preserves text typed in the meantime', async () => {
  const { result } = renderHook(() => useAuthoringDraft('d1'));
  await waitFor(() => expect(result.current.draft).not.toBeNull());
  act(() => result.current.edit('title', 'My unsaved work'));
  jest.mocked(api.get).mockImplementation(async url => ({ data: url.endsWith('/jobs') ? [] : { ...draft, revision: 4 } }));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.form?.title).toBe('My unsaved work');
  expect(result.current.conflict).toBe(true);
});
