import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ProblemAuthoring from '../../../features/admin/authoring/ProblemAuthoring';
import authoringService from '../../../services/admin/authoringService';
import { useAuth } from '../../../context/AuthContext';
import type { DraftSummary } from '../../../features/admin/authoring/types';

jest.mock('../../../services/admin/authoringService');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const readiness = (over: Partial<DraftSummary['readiness']> = {}): DraftSummary['readiness'] => ({
  hasStatement: true, hasSolution: true, hasGenerator: false, testcases: { total: 4, withOutput: 4 },
  latestPdfRevision: 3, latestJobs: { compile_solution: { status: 'succeeded', revision: 5 } }, activeJob: false, ...over,
});
const row = (over: Partial<DraftSummary> = {}): DraftSummary => ({
  id: 'd1', problemId: 'sum', title: 'Sum', authorProfileId: 'p1', authorAkaName: 'Ada', status: 'generated',
  revision: 5, verifiedRevision: null, createdBy: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z',
  publishedAt: null, readiness: readiness(), ...over,
});
const DRAFTS = [
  row(),
  row({ id: 'd2', problemId: 'grid_paths', title: 'Grid paths', authorProfileId: 'p2', authorAkaName: 'Mint', status: 'published', revision: 9, verifiedRevision: 9, publishedAt: '2026-11-02T00:00:00Z', readiness: readiness({ latestPdfRevision: 9, latestJobs: { compile_solution: { status: 'succeeded', revision: 9 } } }) }),
];

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; };
const show = (path = '/admin/authoring') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      {['/admin/authoring', '/admin/authoring/profiles', '/admin/authoring/ai-docs'].map((p) => (
        <Route key={p} path={p} element={<><ProblemAuthoring /><Where /></>} />
      ))}
      <Route path="/admin/authoring/:draftId" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const TITLES: Record<string, string> = { sum: 'Sum', grid_paths: 'Grid paths' };
// The title is the row's link (DataTable has one primary control per row); the id is mono text.
const rowOf = async (id: string) => (await screen.findByRole('link', { name: TITLES[id] })).closest('tr') as HTMLElement;

describe('Authoring hub and drafts list (§7.9)', () => {
  beforeEach(() => {
    jest.mocked(useAuth).mockReturnValue({ user: { id: 7, username: 'kru', role: 'staff' }, isLoading: false } as ReturnType<typeof useAuth>);
    jest.mocked(authoringService.listDrafts).mockImplementation(async (scope) => (scope === 'mine' ? [] : DRAFTS) as never);
    jest.mocked(authoringService.listProfiles).mockResolvedValue([
      { id: 'p1', userId: null, akaName: 'Ada', realName: 'Ada L', defaultLanguage: 'English', countryCode: 'GBR', hasProfileImage: false, createdAt: '', updatedAt: '' },
      { id: 'p2', userId: null, akaName: 'Mint', realName: 'Mint K', defaultLanguage: 'Thai', countryCode: 'THA', hasProfileImage: false, createdAt: '', updatedAt: '' },
    ] as never);
  });

  it('header: title, counts, New draft and the three sub-tabs', async () => {
    show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Authoring' })).toBeInTheDocument();
    expect(await screen.findByText('2 drafts · 1 published')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Authoring sections' });
    expect(within(tabs).getByRole('link', { name: 'Drafts' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Author profiles' })).toHaveAttribute('href', '/admin/authoring/profiles');
    expect(within(tabs).getByRole('link', { name: 'AI docs' })).toHaveAttribute('href', '/admin/authoring/ai-docs');
    fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
    expect(await screen.findByRole('dialog', { name: 'New draft' })).toBeInTheDocument();
  });

  it('New draft creates the draft with the author metadata and opens it', async () => {
    jest.mocked(authoringService.createDraft).mockResolvedValue({ id: 'd9' } as never);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    const dialog = await screen.findByRole('dialog', { name: 'New draft' });
    fireEvent.change(within(dialog).getByLabelText('Problem ID'), { target: { value: 'new' } });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'New problem' } });
    fireEvent.change(within(dialog).getByLabelText('AKA name'), { target: { value: 'Writer' } });
    fireEvent.change(within(dialog).getByLabelText('Real name'), { target: { value: 'Name' } });
    expect(within(dialog).getByRole('button', { name: 'Create draft' })).toHaveAttribute('type', 'submit');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(authoringService.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      problemId: 'new', title: 'New problem', authorAkaName: 'Writer', authorRealName: 'Name', generatorCpp: null,
    })));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/authoring/d9'));
  });

  it('rows: id link, title, author, readiness squares, status dot, updated', async () => {
    show();
    const sum = await rowOf('sum');
    expect(within(sum).getByRole('link', { name: 'Sum' })).toHaveAttribute('href', '/admin/authoring/d1');
    expect(sum).toHaveTextContent('sum');
    expect(sum).toHaveTextContent('Ada');
    expect(within(sum).getByRole('img', { name: 'Statement done, Solution done, Testcases done, PDF out of date, Verified not yet' })).toBeInTheDocument();
    expect(sum).toHaveTextContent('Generated');
    expect(await rowOf('grid_paths')).toHaveTextContent('Published · rev 9');
    expect(screen.getByText(/Ready = Statement · Solution · Testcases · PDF · Verified/)).toBeInTheDocument();
  });

  it('row menu: Open; Start new revision only when published', async () => {
    const user = userEvent.setup({ delay: 20 });
    jest.mocked(authoringService.startNewRevision).mockResolvedValue({} as never);
    show();
    await user.click(within(await rowOf('sum')).getByRole('button', { name: 'Actions for sum' }));
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Start new revision' })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(within(await rowOf('grid_paths')).getByRole('button', { name: 'Actions for grid_paths' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Start new revision' }));
    await waitFor(() => expect(authoringService.startNewRevision).toHaveBeenCalledWith('d2'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/authoring/d2'));
  });

  it('delete is a destructive confirm naming the draft; a refusal keeps the row and shows why', async () => {
    const user = userEvent.setup({ delay: 20 });
    jest.mocked(authoringService.deleteDraft).mockRejectedValueOnce({ response: { status: 409, data: { message: 'The authoring draft is busy' } } });
    show();
    await user.click(within(await rowOf('sum')).getByRole('button', { name: 'Actions for sum' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete sum?' });
    expect(dialog).toHaveTextContent('This permanently deletes this authoring draft and its draft-only artifacts.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The authoring draft is busy');
    expect(screen.getByRole('link', { name: 'Sum' })).toBeInTheDocument();

    jest.mocked(authoringService.deleteDraft).mockResolvedValue({ message: 'ok', problemId: 'sum', wasPublished: false });
    await user.click(within(await rowOf('sum')).getByRole('button', { name: 'Actions for sum' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete sum?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(authoringService.deleteDraft).toHaveBeenLastCalledWith('d1'));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Sum' })).toBeNull());
  });

  it('filters live in the URL: search, author and status narrow the list', async () => {
    show('/admin/authoring?q=grid');
    await rowOf('grid_paths');
    expect(screen.queryByRole('link', { name: 'Sum' })).toBeNull();
    expect(screen.getByText('1 draft')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    await rowOf('sum');
    show('/admin/authoring?status=published');
    const lists = await screen.findAllByRole('table');
    expect(await within(lists[1]).findByRole('link', { name: 'Grid paths' })).toBeInTheDocument();
    expect(within(lists[1]).queryByRole('link', { name: 'Sum' })).toBeNull();
  });

  it('Mine shows the server-matched drafts, and explains when no profile matches the username', async () => {
    show();
    await rowOf('sum');
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    await waitFor(() => expect(authoringService.listDrafts).toHaveBeenCalledWith('mine'));
    expect(await screen.findByText('No author profile is linked to your username.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('scope=mine');
  });

  it('Author profiles and AI docs render under the same hub header', async () => {
    jest.mocked(authoringService.listProfileSyncs).mockResolvedValue([]);
    show('/admin/authoring/ai-docs');
    const tabs = await screen.findByRole('navigation', { name: 'Authoring sections' });
    expect(within(tabs).getByRole('link', { name: 'AI docs' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Copy for AI agent' })).toBeInTheDocument();
  });
});
