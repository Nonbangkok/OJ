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


test('History no longer lists profile sync runs (they live on Author profiles)', () => {
  render(<JobHistory jobs={[baseJob]} onError={jest.fn()} />);
  expect(screen.queryByText(/profile sync runs/i)).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalledWith('/admin/authoring/profile-syncs');
});
