import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import api from '../../../services/api';
import TestcaseFiles from './TestcaseFiles';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const base = '/admin/authoring/drafts/draft-1/testcases';
const metadata = {
  id: 'case-1',
  caseNumber: 1,
  filename: 'sample.in',
  inputBytes: 2,
  outputBytes: null,
  hasOutput: false,
  source: 'uploaded',
  sourceRevision: 7,
  createdAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:00Z',
};
const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const patch = jest.mocked(api.patch);
const remove = jest.mocked(api.delete);
const selectFile = (label: string, file: File) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
function setup(disabled = false) {
  const onMutated = jest.fn(async () => {});
  const onError = jest.fn();
  const props = { draftId: 'draft-1', revision: 7, disabled, onMutated, onError };
  return { ...render(<TestcaseFiles {...props} />), props, onMutated, onError };
}
beforeEach(() => {
  jest.resetAllMocks();
  get.mockResolvedValue({ data: { revision: 7, testcases: [metadata] } });
  post.mockResolvedValue({ data: { revision: 8 } });
  patch.mockResolvedValue({ data: { revision: 8 } });
  remove.mockResolvedValue({ data: { revision: 8 } });
});

test('refreshes generated artifacts even when the source revision is unchanged', async () => {
  const { props, rerender } = setup();
  expect(await screen.findByText('Missing output')).toBeInTheDocument();
  get.mockResolvedValue({ data: { revision: 7, testcases: [{ ...metadata, hasOutput: true, outputBytes: 3 }] } });
  rerender(<TestcaseFiles {...props} artifactVersion="generated-at-new-time" />);
  await waitFor(() => expect(screen.queryByText('Missing output')).not.toBeInTheDocument());
});

test('lists metadata without fetching contents and inspects bounded text on demand', async () => {
  setup();
  expect(await screen.findByText('sample.in')).toBeInTheDocument();
  expect(screen.getByText('Missing output')).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(1);
  get.mockResolvedValueOnce({ data: { ...metadata, input: 'é'.repeat(20000), output: null } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect sample.in' }));
  const preview = await screen.findByRole('dialog');
  expect(within(preview).getByLabelText('Input preview').textContent).toHaveLength(16384);
  expect(within(preview).getByText(/truncated/i)).toBeInTheDocument();
  expect(within(preview).getByText('Missing output')).toBeInTheDocument();
  expect(get).toHaveBeenLastCalledWith(`${base}/case-1`);
});

test.each([false, true])(
  'append preserves absent versus empty output (include output: %s)',
  async (includeOutput) => {
    const { onMutated } = setup();
    await screen.findByText('sample.in');
    const input = new File(['42'], 'next.in');
    selectFile('New testcase input', input);
    if (includeOutput) selectFile('New testcase output (optional)', new File([], 'next.out'));
    get.mockResolvedValue({
      data: {
        revision: 8,
        testcases: [metadata, { ...metadata, id: 'case-2', filename: 'next.in', caseNumber: 2 }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Append testcase' }));
    await screen.findByText('next.in');
    expect(post).toHaveBeenCalledTimes(1);
    const [url, payload] = post.mock.calls[0];
    const body = payload as FormData;
    expect(url).toBe(base);
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('expectedRevision')).toBe('7');
    expect(body.get('input')).toBe(input);
    expect(body.has('output')).toBe(includeOutput);
    if (includeOutput) expect((body.get('output') as File).size).toBe(0);
    expect(onMutated).toHaveBeenCalledTimes(1);
  }
);

test('ZIP replacement requires explicit confirmation and cancellation preserves selected file', async () => {
  setup();
  await screen.findByText('sample.in');
  const archive = new File(['zip'], 'cases.zip');
  selectFile('Testcase ZIP archive', archive);
  fireEvent.click(screen.getByRole('button', { name: 'Replace all from ZIP' }));
  expect(post).not.toHaveBeenCalled();
  let dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Replace all from ZIP' }));
  dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm replacement' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect((post.mock.calls[0][1] as FormData).get('archive')).toBe(archive);
  expect((post.mock.calls[0][1] as FormData).get('expectedRevision')).toBe('7');
});

test('output-only replacement uploads an empty file and input replacement warns about invalidation', async () => {
  setup();
  await screen.findByText('sample.in');
  fireEvent.click(screen.getByRole('button', { name: 'Replace files for sample.in' }));
  expect(screen.getByText(/replacing input.*clears.*output/i)).toBeInTheDocument();
  selectFile('Replacement output (optional)', new File([], 'sample.out'));
  fireEvent.click(screen.getByRole('button', { name: 'Save replacement files' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch.mock.calls[0][0]).toBe(`${base}/case-1`);
  const body = patch.mock.calls[0][1] as FormData;
  expect(body.get('expectedRevision')).toBe('7');
  expect(body.has('input')).toBe(false);
  expect((body.get('output') as File).size).toBe(0);
});

test('deletion confirms the filename and sends revision in the JSON body', async () => {
  const { onMutated } = setup();
  await screen.findByText('sample.in');
  fireEvent.click(screen.getByRole('button', { name: 'Delete sample.in' }));
  expect(remove).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/sample.in/)).toBeInTheDocument();
  get.mockResolvedValue({ data: { revision: 8, testcases: [] } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm deletion' }));
  await screen.findByText('No testcases yet.');
  expect(remove).toHaveBeenCalledWith(`${base}/case-1`, { data: { expectedRevision: 7 } });
  expect(onMutated).toHaveBeenCalledTimes(1);
});

test('read-only state disables every mutation while keeping inspection available', async () => {
  setup(true);
  await screen.findByText('sample.in');
  for (const name of [
    'Append testcase',
    'Replace all from ZIP',
    'Replace files for sample.in',
    'Delete sample.in',
  ]) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
  }
  expect(screen.getByLabelText('New testcase input')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Inspect sample.in' })).toBeEnabled();
});

test('failed append retains selected files and old cases and prevents duplicate pending operations', async () => {
  const { onError, onMutated } = setup();
  await screen.findByText('sample.in');
  let reject!: (error: Error) => void;
  post.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  const input = new File(['42'], 'next.in');
  selectFile('New testcase input', input);
  const button = screen.getByRole('button', { name: 'Append testcase' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(post).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  const error = new Error('Conflict');
  reject(error);
  await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  expect(screen.getByText('sample.in')).toBeInTheDocument();
  expect((screen.getByLabelText('New testcase input') as HTMLInputElement).files?.[0]).toBe(input);
  expect(onMutated).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect((post.mock.calls[1][1] as FormData).get('input')).toBe(input);
});

test('opening the replacement form preserves the visible append file selection', async () => {
  setup();
  await screen.findByText('sample.in');
  const input = new File(['42'], 'next.in');
  selectFile('New testcase input', input);
  fireEvent.click(screen.getByRole('button', { name: 'Replace files for sample.in' }));
  expect((screen.getByLabelText('New testcase input') as HTMLInputElement).files?.[0]).toBe(input);
});

test('a mutation discards any inspection response that arrives after the mutation', async () => {
  setup();
  await screen.findByText('sample.in');
  let resolve!: (response: unknown) => void;
  get.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Inspect sample.in' }));
  selectFile('New testcase input', new File(['42'], 'next.in'));
  fireEvent.click(screen.getByRole('button', { name: 'Append testcase' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh testcases' })).toBeEnabled()
  );
  await act(async () => resolve({ data: { ...metadata, input: 'obsolete input', output: null } }));
  expect(screen.queryByText('obsolete input')).not.toBeInTheDocument();
});

test('keeps mutations pending until the parent refresh finishes and uses the next revision', async () => {
  const { props, onMutated, rerender } = setup();
  await screen.findByText('sample.in');
  let finishRefresh!: () => void;
  onMutated.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishRefresh = resolve;
    })
  );
  selectFile('New testcase input', new File(['42'], 'next.in'));
  fireEvent.click(screen.getByRole('button', { name: 'Append testcase' }));
  await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Delete sample.in' })).toBeDisabled();
  await act(async () => {
    finishRefresh();
  });
  rerender(<TestcaseFiles {...props} revision={8} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete sample.in' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete sample.in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith(`${base}/case-1`, { data: { expectedRevision: 8 } })
  );
});

test('read-only changes also disable an open confirmation and replacement form', async () => {
  const { props, rerender } = setup();
  await screen.findByText('sample.in');
  fireEvent.click(screen.getByRole('button', { name: 'Replace files for sample.in' }));
  selectFile('Replacement input (optional)', new File(['new'], 'sample.in'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete sample.in' }));
  rerender(<TestcaseFiles {...props} disabled />);
  expect(screen.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save replacement files' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(remove).not.toHaveBeenCalled();
});

test('failed inspection retains the previous preview including empty output', async () => {
  const { onError } = setup();
  await screen.findByText('sample.in');
  get.mockResolvedValueOnce({
    data: { ...metadata, hasOutput: true, outputBytes: 0, input: 'current input', output: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect sample.in' }));
  await screen.findByText('current input');
  expect(screen.getByLabelText('Output preview')).toHaveTextContent('(Empty output)');
  const error = new Error('Network failure');
  get.mockRejectedValueOnce(error);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect sample.in' }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  expect(screen.getByText('current input')).toBeInTheDocument();
});

test('notifies the parent if an upload succeeds after switching away from the tab', async () => {
  const { unmount, onMutated } = setup();
  await screen.findByText('sample.in');
  let finishUpload!: (response: { data: { revision: number } }) => void;
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      finishUpload = resolve;
    })
  );
  selectFile('New testcase input', new File(['42'], 'next.in'));
  fireEvent.click(screen.getByRole('button', { name: 'Append testcase' }));
  unmount();
  await act(async () => {
    finishUpload({ data: { revision: 8 } });
  });
  expect(onMutated).toHaveBeenCalledTimes(1);
});
