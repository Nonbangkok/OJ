import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../components/ui';
import LessonsAdminPage from '../../../features/admin/lessons/LessonsAdminPage';
import lessonsAdminService from '../../../services/admin/lessonsAdminService';
import type { AdminLessonOverview, LessonImportPlan } from '../../../types';

// The file-drop → dry run → import chain renders several times; give it room under the full parallel run.
configure({ asyncUtilTimeout: 4000 });

jest.mock('../../../services/admin/lessonsAdminService');
const service = jest.mocked(lessonsAdminService);

const overview: AdminLessonOverview = {
  tracks: [
    { id: 1, slug: 'foundations', title: 'Foundations', is_visible: true, module_count: 5, lesson_count: 18, updated_at: '2026-11-18T07:02:00Z' },
    { id: 2, slug: 'graphs', title: 'Graphs', is_visible: false, module_count: 4, lesson_count: 12, updated_at: '2026-11-18T07:02:00Z' },
  ],
  imports: [{ id: 14, imported_by: 'nattapat', bundle_sha256: 'a'.repeat(64), source_commit: 'a1b2c3d4e5', added: 2, changed: 4, removed: 0, created_at: '2026-11-18T07:02:00Z' }],
};

const plan = (overrides: Partial<LessonImportPlan> = {}): LessonImportPlan => ({
  bundleSha256: 'b'.repeat(64),
  sourceCommit: 'f3e9c21aa',
  lessons: {
    added: [{ slug: 'dsu', title: 'Disjoint Set Union', track: 'data-structures', module: 'sets' }],
    changed: [{ slug: 'prefix-sums', title: 'Prefix Sums', track: 'foundations', module: 'complexity' }],
    removed: [],
    unchanged: 40,
  },
  tracks: { added: ['data-structures'], removed: [] },
  issues: [],
  ...overrides,
});

const zip = new File(['PK'], 'lessons-bundle.zip', { type: 'application/zip' });

const renderPage = () => render(
  <ToastProvider>
    <MemoryRouter><LessonsAdminPage /></MemoryRouter>
  </ToastProvider>,
);

const dropBundle = async () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => { fireEvent.change(input, { target: { files: [zip] } }); });
};

beforeEach(() => {
  service.getLessonOverview.mockResolvedValue(overview);
});

describe('LessonsAdminPage', () => {
  it('shows tracks, visibility and import history', async () => {
    renderPage();
    expect(await screen.findByText('Foundations')).toBeInTheDocument();
    expect(screen.getByText(/2 tracks · 30 lessons · last import/)).toHaveTextContent('by nattapat');
    expect(screen.getByRole('button', { name: 'Hide Foundations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Graphs' })).toBeInTheDocument();
    expect(screen.getByText('+2 ~4 −0')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d')).toBeInTheDocument();
  });

  it('toggles a track and reports failures', async () => {
    service.setLessonTrackVisibility.mockResolvedValueOnce({ id: 2, isVisible: true }).mockRejectedValueOnce(new Error('nope'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Show Graphs' }));
    expect(await screen.findByRole('button', { name: 'Hide Graphs' })).toBeInTheDocument();
    expect(service.setLessonTrackVisibility).toHaveBeenCalledWith(2, true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Foundations' }));
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });

  it('dry-runs a dropped bundle, then imports it and reloads', async () => {
    service.importLessonBundle
      .mockResolvedValueOnce({ kind: 'preview', plan: plan() })
      .mockResolvedValueOnce({ kind: 'imported', plan: plan(), importId: 15 });
    renderPage();
    await screen.findByText('Foundations');
    await dropBundle();
    expect(service.importLessonBundle).toHaveBeenCalledWith(zip, { dryRun: true });
    expect(await screen.findByText('+1 added')).toBeInTheDocument();
    expect(screen.getByText('New tracks: data-structures')).toBeInTheDocument();
    expect(screen.getByText('CP-Author@f3e9c21')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Disjoint Set Union')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })); });
    expect(service.importLessonBundle).toHaveBeenLastCalledWith(zip, { dryRun: false, confirmRemovals: false });
    expect(await screen.findByText('Bundle imported: 2 lessons changed.')).toBeInTheDocument();
    await waitFor(() => expect(service.getLessonOverview).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lists bundle problems and blocks the import', async () => {
    service.importLessonBundle.mockResolvedValueOnce({
      kind: 'preview',
      plan: plan({ issues: [{ path: 'graphs/01-traversal/bfs.md', message: 'problem "P9999" does not exist in this grader' }] }),
    });
    renderPage();
    await screen.findByText('Foundations');
    await dropBundle();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('1 problem in this bundle');
    expect(alert).toHaveTextContent('graphs/01-traversal/bfs.md — problem "P9999" does not exist in this grader');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('requires confirming removals that delete learner progress', async () => {
    const removing = plan({ lessons: { added: [], changed: [], removed: [{ slug: 'bfs', title: 'BFS', track: 'graphs', module: 'traversal', usersWithProgress: 12 }], unchanged: 3 } });
    service.importLessonBundle
      .mockResolvedValueOnce({ kind: 'preview', plan: removing })
      .mockResolvedValueOnce({ kind: 'imported', plan: removing, importId: 16 });
    renderPage();
    await screen.findByText('Foundations');
    await dropBundle();
    expect(await screen.findByText('12 learners lose their progress on this lesson')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Delete 1 lesson — 12 completion records will be lost/ }));
    const importButton = screen.getByRole('button', { name: 'Import' });
    expect(importButton).toBeEnabled();
    await act(async () => { fireEvent.click(importButton); });
    expect(service.importLessonBundle).toHaveBeenLastCalledWith(zip, { dryRun: false, confirmRemovals: true });
  });

  it('shows the fresh plan when the server asks for confirmation after the dry run', async () => {
    const fresh = plan({ lessons: { added: [], changed: [], removed: [{ slug: 'bfs', title: 'BFS', track: 'graphs', module: 'traversal', usersWithProgress: 1 }], unchanged: 3 } });
    service.importLessonBundle
      .mockResolvedValueOnce({ kind: 'preview', plan: plan() })
      .mockResolvedValueOnce({ kind: 'needs_confirmation', plan: fresh, message: 'This import deletes lessons that learners have completed.' });
    renderPage();
    await screen.findByText('Foundations');
    await dropBundle();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Import' })); });
    expect(await screen.findByText('This import deletes lessons that learners have completed.')).toBeInTheDocument();
    expect(screen.getByText('1 learner loses their progress on this lesson')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('reports an unreadable bundle', async () => {
    service.importLessonBundle.mockRejectedValueOnce(Object.assign(new Error('x'), {
      response: { status: 400, data: { message: 'The upload is not a readable ZIP file.' } },
    }));
    renderPage();
    await screen.findByText('Foundations');
    await dropBundle();
    expect(await screen.findByText('The upload is not a readable ZIP file.')).toBeInTheDocument();
  });

  it('shows a retry when the overview fails', async () => {
    service.getLessonOverview.mockReset();
    service.getLessonOverview.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(overview);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Foundations')).toBeInTheDocument();
  });
});
