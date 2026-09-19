import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import api from '../../../services/api';
import JobHistory from '../../../features/admin/authoring/JobHistory';

jest.mock('../../../services/api');

const baseJob = {
  id: 'j1',
  draftId: 'd1',
  draftRevision: 4,
  jobType: 'verify_all',
  status: 'succeeded',
  createdAt: '2026-09-19T01:00:00.000Z',
  errorCode: null,
  errorMessage: null,
};

beforeEach(() => {
  jest.resetAllMocks();
});

test('renders sync_pdf jobs with the profile sync label and explainer', async () => {
  const jobs = [
    { ...baseJob, id: 'sync1', jobType: 'sync_pdf', status: 'running' },
    { ...baseJob, id: 'verify1' },
  ];
  render(<JobHistory jobs={jobs} onError={jest.fn()} />);

  // Labeled action cell + running badge + explainer note.
  expect(screen.getByText('Profile sync PDF')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent(/republishes it if it was published/i);
  expect(screen.getByText('Running')).toBeInTheDocument();
  expect(screen.getByText('Verify All')).toBeInTheDocument();
});

test('a failed sync job surfaces its error through the inspect dialog', async () => {
  const jobs = [{ ...baseJob, id: 'sync1', jobType: 'sync_pdf', status: 'failed',
    errorCode: 'sync_republish_failed',
    errorMessage: 'The published problem changed outside authoring; the PDF was not republished' }];
  jest.mocked(api.get).mockResolvedValue({ data: jobs[0] });
  render(<JobHistory jobs={jobs} onError={jest.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: /Inspect Profile sync PDF/ }));

  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Profile sync — the author snapshot was refreshed');
  expect(screen.getByRole('alert')).toHaveTextContent('sync_republish_failed');
  expect(dialog).toHaveTextContent('failed');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/authoring/jobs/sync1'));
});

test('no sync explainer when no sync_pdf job exists', () => {
  render(<JobHistory jobs={[baseJob]} onError={jest.fn()} />);
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
  expect(screen.getByText('Verify All')).toBeInTheDocument();
});

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
  render(<JobHistory jobs={[baseJob]} onError={jest.fn()} />);

  expect(await screen.findByText('Writer')).toBeInTheDocument();
  expect(screen.getByText('2/3 synced (1 not synced)')).toBeInTheDocument();
  expect(screen.getByText('Profile sync runs')).toBeInTheDocument();

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
  render(<JobHistory jobs={[baseJob]} onError={jest.fn()} />);
  expect(await screen.findByText('No profile sync runs yet.')).toBeInTheDocument();
});

test('surfaces a profile sync listing error', async () => {
  jest.mocked(api.get).mockRejectedValue(new Error('network down'));
  const onError = jest.fn();
  render(<JobHistory jobs={[baseJob]} onError={onError} />);
  await waitFor(() => expect(onError).toHaveBeenCalled());
});
