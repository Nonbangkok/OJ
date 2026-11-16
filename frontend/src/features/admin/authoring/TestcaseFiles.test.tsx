import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  const view = render(<TestcaseFiles {...props} />);
  // The one FileDrop's picker: the only file input in the panel (dialogs are portaled).
  const drop = (...files: File[]) =>
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files } });
  return { ...view, props, onMutated, onError, drop };
}
/** Opens the row's ⋯ menu and returns the named item. */
async function rowItem(filename: string, label: string) {
  const user = userEvent.setup({ delay: 10 });
  await user.click(screen.getByRole('button', { name: `Actions for ${filename}` }));
  return screen.findByRole('menuitem', { name: label });
}
async function chooseRowItem(filename: string, label: string) {
  const user = userEvent.setup({ delay: 10 });
  await user.click(await rowItem(filename, label));
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

test('lists metadata without fetching contents and inspects bounded text from the row menu', async () => {
  setup();
  expect(await screen.findByText('sample.in')).toBeInTheDocument();
  expect(screen.getByText('Missing output')).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(1);
  get.mockResolvedValueOnce({ data: { ...metadata, input: 'é'.repeat(20000), output: null } });
  await chooseRowItem('sample.in', 'Inspect');
  const preview = await screen.findByRole('dialog');
  expect(within(preview).getByLabelText('Input preview').textContent).toHaveLength(16384);
  expect(within(preview).getByText(/truncated/i)).toBeInTheDocument();
  expect(within(preview).getByText('Missing output')).toBeInTheDocument();
  expect(get).toHaveBeenLastCalledWith(`${base}/case-1`);
});

test.each([false, true])(
  'a dropped pair appends one case and preserves absent versus empty output (include output: %s)',
  async (includeOutput) => {
    const { onMutated, drop } = setup();
    await screen.findByText('sample.in');
    const input = new File(['42'], 'next.in');
    get.mockResolvedValue({
      data: { revision: 8, testcases: [metadata, { ...metadata, id: 'case-2', filename: 'next.in', caseNumber: 2 }] },
    });
    if (includeOutput) drop(input, new File([], 'next.out'));
    else drop(input);
    await screen.findByText('next.in');
    expect(post).toHaveBeenCalledTimes(1);
    const [url, payload] = post.mock.calls[0];
    const body = payload as FormData;
    expect(url).toBe(base);
    expect(body.get('expectedRevision')).toBe('7');
    expect(body.get('input')).toBe(input);
    expect(body.has('output')).toBe(includeOutput);
    if (includeOutput) expect((body.get('output') as File).size).toBe(0);
    expect(onMutated).toHaveBeenCalledTimes(1);
  }
);

test('several dropped pairs append in order, each against the revision the last one returned', async () => {
  const { onMutated, drop } = setup();
  await screen.findByText('sample.in');
  post.mockResolvedValueOnce({ data: { revision: 8 } }).mockResolvedValueOnce({ data: { revision: 9 } });
  drop(new File(['2'], '2.in'), new File(['2'], '2.out'), new File(['1'], '1.in'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  const sent = post.mock.calls.map(([, body]) => [(body as FormData).get('expectedRevision'), ((body as FormData).get('input') as File).name]);
  expect(sent).toEqual([['7', '1.in'], ['8', '2.in']]);
  await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1));
});

test('a drop the panel cannot pair says why and uploads nothing', async () => {
  const { drop } = setup();
  await screen.findByText('sample.in');
  drop(new File(['x'], '4.out'));
  expect(await screen.findByText('4.out has no matching 4.in.')).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test('a dropped ZIP replaces the set only after explicit confirmation', async () => {
  const { drop } = setup();
  await screen.findByText('sample.in');
  const archive = new File(['zip'], 'cases.zip');
  drop(archive);
  expect(post).not.toHaveBeenCalled();
  let dialog = screen.getByRole('dialog', { name: 'Replace all 1 testcase?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  drop(archive);
  dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm replacement' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect((post.mock.calls[0][1] as FormData).get('archive')).toBe(archive);
  expect((post.mock.calls[0][1] as FormData).get('expectedRevision')).toBe('7');
});

test('output-only replacement uploads an empty file and input replacement warns about invalidation', async () => {
  setup();
  await screen.findByText('sample.in');
  await chooseRowItem('sample.in', 'Replace files');
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
  await chooseRowItem('sample.in', 'Delete');
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
  const { drop } = setup(true);
  await screen.findByText('sample.in');
  expect(await rowItem('sample.in', 'Replace files')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('menuitem', { name: 'Inspect' })).not.toHaveAttribute('aria-disabled');
  expect(screen.getByRole('button', { name: /Drop testcase files here/ })).toHaveAttribute('aria-disabled', 'true');
  drop(new File(['42'], 'next.in'));
  expect(post).not.toHaveBeenCalled();
});

test('a failed append keeps the old cases and prevents duplicate pending operations', async () => {
  const { onError, onMutated, drop } = setup();
  await screen.findByText('sample.in');
  let reject!: (error: Error) => void;
  post.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const input = new File(['42'], 'next.in');
  drop(input);
  drop(input);
  expect(post).toHaveBeenCalledTimes(1);
  const error = new Error('Conflict');
  reject(error);
  await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  expect(screen.getByText('sample.in')).toBeInTheDocument();
  expect(onMutated).not.toHaveBeenCalled();
  drop(input);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect((post.mock.calls[1][1] as FormData).get('input')).toBe(input);
});

test('a later pair failing still refreshes the cases the earlier pairs added, then reports', async () => {
  const { onError, onMutated, drop } = setup();
  await screen.findByText('sample.in');
  const error = new Error('second failed');
  post.mockResolvedValueOnce({ data: { revision: 8 } }).mockRejectedValueOnce(error);
  drop(new File(['1'], '1.in'), new File(['2'], '2.in'));
  await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  expect(onMutated).toHaveBeenCalledTimes(1);
});

test('a mutation discards any inspection response that arrives after the mutation', async () => {
  const { drop } = setup();
  await screen.findByText('sample.in');
  let resolve!: (response: unknown) => void;
  get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await chooseRowItem('sample.in', 'Inspect');
  drop(new File(['42'], 'next.in'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh testcases' })).toBeEnabled());
  await act(async () => resolve({ data: { ...metadata, input: 'obsolete input', output: null } }));
  expect(screen.queryByText('obsolete input')).not.toBeInTheDocument();
});

test('keeps mutations pending until the parent refresh finishes and uses the next revision', async () => {
  const { props, onMutated, rerender, drop } = setup();
  await screen.findByText('sample.in');
  let finishRefresh!: () => void;
  onMutated.mockReturnValueOnce(new Promise<void>((resolve) => { finishRefresh = resolve; }));
  drop(new File(['42'], 'next.in'));
  await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1));
  expect(await rowItem('sample.in', 'Delete')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await act(async () => { finishRefresh(); });
  rerender(<TestcaseFiles {...props} revision={8} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh testcases' })).toBeEnabled());
  await chooseRowItem('sample.in', 'Delete');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(`${base}/case-1`, { data: { expectedRevision: 8 } }));
});

test('read-only changes also disable an open replacement form', async () => {
  const { props, rerender } = setup();
  await screen.findByText('sample.in');
  await chooseRowItem('sample.in', 'Replace files');
  selectFile('Replacement input (optional)', new File(['new'], 'sample.in'));
  rerender(<TestcaseFiles {...props} disabled />);
  expect(screen.getByRole('button', { name: 'Save replacement files' })).toBeDisabled();
});

test('read-only changes also disable an open delete confirmation', async () => {
  const { props, rerender } = setup();
  await screen.findByText('sample.in');
  await chooseRowItem('sample.in', 'Delete');
  rerender(<TestcaseFiles {...props} disabled />);
  expect(screen.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(remove).not.toHaveBeenCalled();
});

test('notifies the parent if an upload succeeds after switching away from the tab', async () => {
  const { unmount, onMutated, drop } = setup();
  await screen.findByText('sample.in');
  let finishUpload!: (response: { data: { revision: number } }) => void;
  post.mockReturnValueOnce(new Promise((resolve) => { finishUpload = resolve; }));
  drop(new File(['42'], 'next.in'));
  unmount();
  await act(async () => { finishUpload({ data: { revision: 8 } }); });
  expect(onMutated).toHaveBeenCalledTimes(1);
});
