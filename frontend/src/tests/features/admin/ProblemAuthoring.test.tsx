import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
import {
  DraftMetadata,
  DraftStatement,
  DraftSolution,
  DraftTestcases,
  DraftGenerator,
  DraftVerify,
} from '../../../features/admin/authoring/DraftWorkspace';
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
  status: 'ready',
  publishedAt: null,
};
function show(path = '/admin/authoring') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/authoring" element={<ProblemAuthoring />} />
        <Route path="/admin/authoring/profiles" element={<ProblemAuthoring />} />
        <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />}>
          <Route index element={<DraftMetadata />} />
          <Route path="metadata" element={<DraftMetadata />} />
          <Route path="statement" element={<DraftStatement />} />
          <Route path="solution" element={<DraftSolution />} />
          <Route path="testcases" element={<DraftTestcases />} />
          <Route path="generator" element={<DraftGenerator />} />
          <Route path="verify" element={<DraftVerify />} />
        </Route>
        <Route path="/admin/authoring/:draftId/editor" element={<ProblemAuthoring editorMode />} />
      </Routes>
    </MemoryRouter>
  );
}
beforeEach(() => {
  jest.resetAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  (useAuth as jest.Mock).mockReturnValue({ user: { role: 'admin' }, isLoading: false });
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/drafts')
      ? [draft]
      : url.endsWith('/testcases')
        ? { revision: 3, testcases: [] }
        : url.endsWith('/d1')
          ? draft
          : [],
  }));
});
test('staff cannot load private authoring data even through a direct URL', () => {
  (useAuth as jest.Mock).mockReturnValue({ user: { role: 'staff' }, isLoading: false });
  show('/admin/authoring/d1');
  expect(screen.getByText(/admin access required/i)).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});
test('lists resumable drafts and creates a draft with explicit author metadata', async () => {
  show();
  expect(await screen.findByRole('link', { name: /sum/i })).toHaveAttribute(
    'href',
    '/admin/authoring/d1'
  );
  expect(screen.getByRole('region', { name: 'Saved drafts' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New draft' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Author profiles' })).toHaveAttribute(
    'href',
    '/admin/authoring/profiles'
  );
  // The Problem Management link was removed by design: visibility management
  // lives in the admin problems section, not on the authoring landing page.
  expect(screen.queryByRole('link', { name: 'Problem Management' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
  fireEvent.change(screen.getByLabelText('Problem ID'), { target: { value: 'new' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New problem' } });
  fireEvent.change(screen.getByLabelText('AKA name'), { target: { value: 'Writer' } });
  fireEvent.change(screen.getByLabelText('Real name'), { target: { value: 'Name' } });
  jest.mocked(api.post).mockResolvedValue({ data: draft });
  expect(screen.getByRole('button', { name: 'Create draft' })).toHaveAttribute('type', 'submit');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/admin/authoring/drafts',
      expect.objectContaining({
        problemId: 'new',
        title: 'New problem',
        authorAkaName: 'Writer',
        authorRealName: 'Name',
        generatorCpp: null,
      })
    )
  );
  expect(await screen.findByRole('link', { name: 'Statement' })).toBeInTheDocument();
});
test('tabs preserve edits and disable job actions until explicit Save succeeds', async () => {
  show('/admin/authoring/d1');
  fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Edited title' } });
  expect(screen.getByText(/saving/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Statement' }));
  fireEvent.click(screen.getByRole('link', { name: 'Verify & Publish' }));
  expect(screen.getByRole('button', { name: 'Build PDF' })).toBeDisabled();
  fireEvent.click(screen.getByRole('link', { name: 'Solution' }));
  expect(screen.getByRole('button', { name: 'Compile solution' })).toBeDisabled();
  jest
    .mocked(api.patch)
    .mockResolvedValue({ data: { ...draft, title: 'Edited title', revision: 4, status: 'draft' } });
  // The Save now button is gone: autosave fires shortly after the edit.
  await waitFor(
    () => expect(screen.getByRole('button', { name: 'Compile solution' })).toBeEnabled(),
    { timeout: 4000 }
  );
});
test('a revision of a published task keeps its legacy Problem ID locked but leaves metadata editable', async () => {
  const revision = { ...draft, status: 'draft', publishedAt: '2026-09-16T00:00:00.000Z' };
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data:
      url.endsWith('/jobs') || url.endsWith('/author-profiles') || url.endsWith('/assets')
        ? []
        : url.endsWith('/testcases')
          ? { revision: revision.revision, testcases: [] }
          : revision,
  }));
  show('/admin/authoring/d1');
  expect(await screen.findByLabelText('Problem ID')).toBeDisabled();
  expect(screen.getByLabelText('Title')).toBeEnabled();
});
test('Statement tab opens the dedicated editor instead of embedding a narrow source textarea', async () => {
  show('/admin/authoring/d1');
  fireEvent.click(await screen.findByRole('link', { name: 'Statement' }));
  expect(screen.getByRole('link', { name: 'Open full-screen editor' })).toHaveAttribute(
    'href',
    '/admin/authoring/d1/editor'
  );
  expect(screen.queryByLabelText('Statement source')).not.toBeInTheDocument();
});
test('opening the dedicated editor keeps unsaved workspace fields recoverable via session storage', async () => {
  show('/admin/authoring/d1');
  fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Unsaved title' } });
  fireEvent.click(screen.getByRole('link', { name: 'Statement' }));

  // Auto-save captures unsaved edits; opening the editor no longer needs a blocking confirm.
  expect(window.sessionStorage.getItem('oj-authoring-draft:d1')).toContain('Unsaved title');
  fireEvent.click(screen.getByRole('link', { name: 'Open full-screen editor' }));
  expect(screen.queryByLabelText('Statement source')).not.toBeInTheDocument();
});
test('unsaved statement source survives an editor route unmount such as browser Back and Forward', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  const view = show('/admin/authoring/d1/editor');
  fireEvent.change(await screen.findByLabelText('Statement source'), {
    target: { value: '# Recovered work' },
  });

  view.unmount();
  show('/admin/authoring/d1/editor');

  await waitFor(() =>
    expect(screen.getByLabelText('Statement source')).toHaveValue(
      '# Recovered work'
    )
  );
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
});
test('editing recovered source preserves its old base revision across another route unmount', async () => {
  let serverDraft = draft;
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data:
      url.endsWith('/jobs') || url.endsWith('/assets')
        ? []
        : url.endsWith('/testcases')
          ? { revision: serverDraft.revision, testcases: [] }
          : serverDraft,
  }));
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  const first = show('/admin/authoring/d1/editor');
  fireEvent.change(await screen.findByLabelText('Statement source'), {
    target: { value: '# Revision 3 work' },
  });
  first.unmount();

  serverDraft = { ...draft, revision: 4, statementHtml: '# Server revision 4' };
  const second = show('/admin/authoring/d1/editor');
  await waitFor(() => expect(screen.getByText(/server state changed/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Statement source'), {
    target: { value: '# Revision 3 work continued' },
  });
  second.unmount();

  show('/admin/authoring/d1/editor');
  await waitFor(() =>
    expect(screen.getByLabelText('Statement source')).toHaveValue(
      '# Revision 3 work continued'
    )
  );
  expect(screen.getByText(/server state changed/i)).toBeInTheDocument();
});
test('a new edit after clean auto-sync uses the refreshed server revision as its recovery base', async () => {
  let serverDraft = draft;
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/jobs') || url.endsWith('/assets') ? [] : serverDraft,
  }));
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  const first = show('/admin/authoring/d1/editor');
  await screen.findByLabelText('Statement source');
  serverDraft = { ...draft, revision: 4, statementHtml: '# Server revision 4' };
  fireEvent(window, new Event('focus'));
  await waitFor(() =>
    expect(screen.getByLabelText('Statement source')).toHaveValue(
      '# Server revision 4'
    )
  );
  fireEvent.change(screen.getByLabelText('Statement source'), {
    target: { value: '# New work based on revision 4' },
  });
  first.unmount();

  show('/admin/authoring/d1/editor');
  await waitFor(() =>
    expect(screen.getByLabelText('Statement source')).toHaveValue(
      '# New work based on revision 4'
    )
  );
  expect(screen.queryByText(/server state changed/i)).not.toBeInTheDocument();
});
test('full-screen editor previews the current unsaved source automatically in a sandbox', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Sanitized preview</p>' } });
  show('/admin/authoring/d1/editor');
  const source = await screen.findByLabelText('Statement source');
  expect(screen.queryByRole('button', { name: 'Preview statement' })).not.toBeInTheDocument();
  const frame = await screen.findByTitle('Fast statement preview');
  expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  expect(frame).toHaveAttribute('srcdoc', '<p>Sanitized preview</p>');
  fireEvent.change(source, { target: { value: '# Live edit' } });
  expect(api.post).not.toHaveBeenCalledWith('/admin/authoring/drafts/d1/preview', {
    statementHtml: '# Live edit',
  });
  await waitFor(
    () =>
      expect(api.post).toHaveBeenCalledWith('/admin/authoring/drafts/d1/preview', {
        statementHtml: '# Live edit',
      }),
    { timeout: 1500 }
  );
});
test('full-screen editor keeps a stable notices row so the workspace fills the remaining viewport', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  show('/admin/authoring/d1/editor');
  expect(await screen.findByRole('region', { name: 'Editor notices' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Statement editor' })).toBeInTheDocument();
});
test('published statements can begin a new revision in the full-screen editor', async () => {
  const published = { ...draft, status: 'published', publishedAt: '2026-09-16T00:00:00.000Z' };
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/jobs') || url.endsWith('/assets') ? [] : published,
  }));
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  jest.mocked(api.patch).mockResolvedValue({
    data: {
      ...published,
      statementHtml: '<p>Corrected</p>',
      revision: 4,
      verifiedRevision: null,
      status: 'draft',
    },
  });
  show('/admin/authoring/d1/editor');

  const source = await screen.findByLabelText('Statement source');
  expect(source).not.toHaveAttribute('readonly');
  fireEvent.change(source, { target: { value: '<p>Corrected</p>' } });

  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('/admin/authoring/drafts/d1', {
      expectedRevision: 3,
      statementHtml: '<p>Corrected</p>',
    })
  , { timeout: 4000 });
  expect(await screen.findByText('Editing revision — live problem unchanged')).toBeInTheDocument();
});
test('full-screen editor exposes a draggable pane divider and persistent preview zoom controls', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { html: '<p>Preview</p>' } });
  show('/admin/authoring/d1/editor');
  expect(await screen.findByLabelText('Resize source and preview panes')).toBeInTheDocument();
  expect(screen.getByText('100%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(screen.getByText('110%')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reset preview zoom' }));
  expect(screen.getByText('100%')).toBeInTheDocument();
});
test('a slower realtime preview response cannot replace the newest preview', async () => {
  let resolveFirst!: (value: any) => void;
  let resolveSecond!: (value: any) => void;
  jest.mocked(api.post).mockResolvedValueOnce({ data: { html: '<p>Initial</p>' } });
  show('/admin/authoring/d1/editor');
  const source = await screen.findByLabelText('Statement source');
  const frame = await screen.findByTitle('Fast statement preview');
  jest
    .mocked(api.post)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
    );
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
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/d1') ? { ...draft, hasLatestPdf: true, latestPdfRevision: 3 } : [],
  }));
  show('/admin/authoring/d1');
  fireEvent.click(await screen.findByRole('link', { name: 'Verify & Publish' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish problem' }));
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByText(/created as hidden/i)).toBeInTheDocument();
  jest.mocked(api.post).mockResolvedValue({ data: { status: 'published' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm publish' }));
  expect(await screen.findByText(/published — read-only/i)).toBeInTheDocument();
});

test('a changed linked profile syncs into the draft exactly once without disabling the form', async () => {
  const profile = { id: 'p1', akaName: 'New Aka', realName: 'New Real', defaultLanguage: 'English', countryCode: 'USA' };
  const linkedDraft = { ...draft, authorProfileId: 'p1', authorAkaName: 'Old Aka', authorRealName: 'Old Real', language: 'Thai', countryCode: 'THA' };
  // The server reflects the refresh after the POST: the next GET returns the synced snapshot.
  let serverDraft = linkedDraft;
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/drafts')
      ? [serverDraft]
      : url.endsWith('/jobs') || url.endsWith('/assets')
        ? []
        : url.endsWith('/author-profiles')
          ? [profile]
          : url.endsWith('/testcases')
            ? { revision: serverDraft.revision, testcases: [] }
            : serverDraft,
  }));
  jest.mocked(api.post).mockImplementation(async (url) => {
    if (String(url).includes('refresh-author-profile')) {
      serverDraft = { ...serverDraft, authorAkaName: profile.akaName, authorRealName: profile.realName,
        language: profile.defaultLanguage, countryCode: profile.countryCode, revision: serverDraft.revision + 1 };
    }
    return { data: serverDraft };
  });
  show('/admin/authoring/d1');
  expect(await screen.findByLabelText('Problem ID')).toBeEnabled();
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/admin/authoring/drafts/d1/refresh-author-profile',
    { expectedRevision: 3 }
  ));
  // The synced snapshot arrives and the form stays enabled, not stuck busy.
  await waitFor(() => expect(screen.getByLabelText('AKA name')).toHaveValue('New Aka'));
  expect(screen.getByLabelText('Problem ID')).toBeEnabled();
  // The refresh must not repeat endlessly while the page stays open.
  await new Promise(r => setTimeout(r, 300));
  const refreshCalls = () => jest.mocked(api.post).mock.calls.filter(c => String(c[0]).includes('refresh-author-profile')).length;
  expect(refreshCalls()).toBe(1);
});

test('a profile edit made elsewhere syncs when the draft tab regains focus, exactly once', async () => {
  const profile = { id: 'p1', akaName: 'Old Aka', realName: 'Old Real', defaultLanguage: 'Thai', countryCode: 'THA' };
  const linkedDraft = { ...draft, authorProfileId: 'p1' };
  let currentProfile = profile;
  let serverDraft = linkedDraft;
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/jobs') || url.endsWith('/assets') || url.endsWith('/testcases')
      ? []
      : url.endsWith('/author-profiles')
        ? [currentProfile]
        : serverDraft,
  }));
  jest.mocked(api.post).mockImplementation(async (url) => {
    if (String(url).includes('refresh-author-profile')) {
      serverDraft = { ...serverDraft, authorAkaName: currentProfile.akaName, authorRealName: currentProfile.realName,
        language: currentProfile.defaultLanguage, countryCode: currentProfile.countryCode, revision: serverDraft.revision + 1 };
    }
    return { data: serverDraft };
  });
  show('/admin/authoring/d1');
  await screen.findByLabelText('Problem ID');
  const refreshCalls = () => jest.mocked(api.post).mock.calls.filter(c => String(c[0]).includes('refresh-author-profile')).length;
  expect(refreshCalls()).toBe(0); // snapshot matches the profile — nothing to sync

  // The profile is edited on the profiles page; coming back refetches and syncs once.
  currentProfile = { ...profile, realName: 'Edited Real Name' };
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(refreshCalls()).toBe(1));
  await waitFor(() => expect(screen.getByLabelText('Real name')).toHaveValue('Edited Real Name'));
  await new Promise(r => setTimeout(r, 300));
  expect(refreshCalls()).toBe(1); // no loop afterwards
});

test('a draft without a linked profile keeps its metadata inputs enabled', async () => {
  show('/admin/authoring/d1');
  for (const label of ['Problem ID', 'Title', 'AKA name', 'Real name', 'Language', 'Country code']) {
    expect(await screen.findByLabelText(label)).toBeEnabled();
  }
});
