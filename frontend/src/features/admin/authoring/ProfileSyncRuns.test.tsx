import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import api from '../../../services/api';
import ProfileSyncRuns from './ProfileSyncRuns';

jest.mock('../../../services/api');

const baseRun = {
  id: 's1',
  profileId: 'p1',
  profileAkaName: 'Writer',
  status: 'succeeded' as const,
  resultSummary: { synced: 2, failed: 0, deferred: 1, warnings: ['Some drafts were busy and were left on their previous snapshot; re-run the sync later.'] },
  createdAt: '2026-09-19T02:00:00.000Z',
  finishedAt: '2026-09-19T02:01:00.000Z',
  progress: { total: 3, synced: 2, failed: 1 },
};

beforeEach(() => {
  jest.resetAllMocks();
});

test('renders profile sync runs with progress and loads per-draft items on inspect', async () => {
  jest.mocked(api.get).mockResolvedValueOnce({ data: [baseRun] }).mockResolvedValueOnce({ data: {
    ...baseRun,
    status: 'running' as const,
    startedAt: '2026-09-19T02:00:05.000Z',
    items: [
      { draftId: 'd1', problemId: 'AAA', title: 'A problem', status: 'synced', attempts: 1, errorMessage: null, draftStatus: 'published', published: true },
      { draftId: 'd2', problemId: 'BBB', title: 'Busy draft', status: 'deferred', attempts: 5, errorMessage: 'draft busy with another authoring job', draftStatus: 'draft', published: false },
    ],
  } });
  render(<ProfileSyncRuns onError={jest.fn()} />);

  expect(await screen.findByText('Writer')).toBeInTheDocument();
  expect(screen.getByText('2/3 synced (1 not synced)')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Recent profile syncs' })).toBeInTheDocument();
  expect(screen.getByText('Done')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Inspect run/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('running (2/3 synced)');
  expect(dialog).toHaveTextContent('AAA — A problem');
  expect(screen.getByText('draft busy with another authoring job')).toBeInTheDocument();
  expect(screen.getByText('Deferred')).toBeInTheDocument();
  expect(screen.getByText('Synced')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent(/busy and were left/i);
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/admin/authoring/profile-syncs');
    expect(api.get).toHaveBeenCalledWith('/admin/authoring/profile-syncs/s1');
  });
});

test('shows the empty state when no profile sync runs exist', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: [] });
  render(<ProfileSyncRuns onError={jest.fn()} />);
  expect(await screen.findByText('No profile sync runs yet.')).toBeInTheDocument();
});

test('surfaces a profile sync listing error', async () => {
  jest.mocked(api.get).mockRejectedValue(new Error('network down'));
  const onError = jest.fn();
  render(<ProfileSyncRuns onError={onError} />);
  await waitFor(() => expect(onError).toHaveBeenCalled());
});
