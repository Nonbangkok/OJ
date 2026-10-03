import { act, renderHook, waitFor } from '@testing-library/react';
import authoringService from '../../../services/admin/authoringService';
import createStatementPreviewWorker from './statementPreviewWorkerFactory';
import useStatementPreview from './useStatementPreview';

jest.mock('../../../services/admin/authoringService', () => ({
  __esModule: true,
  default: {
    getPreviewContext: jest.fn(),
    draftAssetUrl: jest.fn(),
    previewStatement: jest.fn(),
  },
}));
jest.mock('./statementPreviewWorkerFactory', () => ({ __esModule: true, default: jest.fn() }));

type WorkerMessage = { data: { type: string; generation?: number; html?: string; error?: string } };
const worker = {
  onmessage: null as ((event: WorkerMessage) => void) | null,
  postMessage: jest.fn(),
  terminate: jest.fn(),
  emit(data: WorkerMessage['data']) { this.onmessage?.({ data }); },
};

const mockCreateWorker = jest.mocked(createStatementPreviewWorker);
const mockedService = jest.mocked(authoringService);

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateWorker.mockReturnValue(worker as never);
  mockedService.getPreviewContext.mockResolvedValue({
    html: '<html><article id="statement" class="statement"></article></html>',
    assets: [{ id: 'a1', filename: 'diagram.png' }],
  });
  mockedService.draftAssetUrl.mockReturnValue('/api/admin/authoring/drafts/d1/assets/a1');
});

test('renders unsaved source in the worker without requesting server preview HTML', async () => {
  const { result } = renderHook(() => useStatementPreview('d1', '# Current edit'));

  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'render', source: '# Current edit',
  })));
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'initialize', assets: [{ filename: 'diagram.png', url: '/api/admin/authoring/drafts/d1/assets/a1' }],
  }));
  expect(mockedService.getPreviewContext).toHaveBeenCalledTimes(1);
  expect(mockedService.previewStatement).not.toHaveBeenCalled();
  expect(result.current.state).toBe('loading');
});

test('ignores stale render generations and accepts only the newest result', async () => {
  const { result, rerender } = renderHook(({ source }) => useStatementPreview('d1', source), {
    initialProps: { source: '# First' },
  });
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'render', source: '# First' })));
  const first = worker.postMessage.mock.calls.find(([message]) => message.type === 'render')?.[0];

  rerender({ source: '# Newest' });
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'render', source: '# Newest' })));
  const renders = worker.postMessage.mock.calls.filter(([message]) => message.type === 'render');
  const newest = renders[1]?.[0];

  act(() => worker.emit({ type: 'rendered', generation: first.generation, html: '<p>stale</p>' }));
  expect(result.current.html).toBe('');
  expect(result.current.state).toBe('loading');

  act(() => worker.emit({ type: 'rendered', generation: newest.generation, html: '<p>latest</p>' }));
  expect(result.current.html).toContain('<p>latest</p>');
  expect(result.current.html).not.toContain('<p>stale</p>');
  expect(result.current.state).toBe('ready');
});

test('reports preview errors while leaving the editor source in caller-owned state', async () => {
  const { result } = renderHook(() => useStatementPreview('d1', '<script>bad()</script>'));
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'render' })));
  const render = worker.postMessage.mock.calls.find(([message]) => message.type === 'render')?.[0];

  act(() => worker.emit({ type: 'error', generation: render.generation, error: 'Unsupported statement element: script' }));

  expect(result.current.state).toBe('error');
  expect(result.current.error).toContain('Unsupported statement element');
  expect(result.current.html).toBe('');
});
