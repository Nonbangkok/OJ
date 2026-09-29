import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import useBatchUpload from '../../../hooks/admin/useBatchUpload';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService', () => ({
  __esModule: true,
  default: {
    batchUploadProblems: jest.fn(),
    initBatchUpload: jest.fn(),
    uploadBatchUploadChunk: jest.fn(),
    completeBatchUpload: jest.fn(),
    getBatchUploadProgressEventSource: jest.fn(),
  },
}));

type FakeEventSource = {
  addEventListener: jest.Mock;
  close: jest.Mock;
  emit: (name: string, data: string) => void;
};

const makeEventSource = (): FakeEventSource => {
  const listeners = new Map<string, (event: MessageEvent<string>) => void>();
  const source: FakeEventSource = {
    addEventListener: jest.fn((name: string, listener: (event: MessageEvent<string>) => void) => {
      listeners.set(name, listener);
    }),
    close: jest.fn(),
    emit: (name, data) => listeners.get(name)?.({ data } as MessageEvent<string>),
  };
  return source;
};

const makeFile = (size: number, name = 'problems.zip'): File => {
  const file = new File([], name, { type: 'application/zip' });
  Object.defineProperties(file, {
    size: { value: size },
    slice: {
      value: jest.fn((start: number, end: number) => new Blob([`${start}:${end}`])),
    },
  });
  return file;
};

const chooseFile = async (result: { current: ReturnType<typeof useBatchUpload> }, file: File) => {
  const input = result.current.batchUploadInputRef.current ?? document.createElement('input');
  result.current.batchUploadInputRef.current = input;
  await act(async () => {
    await result.current.handleBatchUploadFileChange({ target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>);
  });
};

describe('useBatchUpload', () => {
  let setLoading: jest.Mock;
  let onCompleted: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    setLoading = jest.fn();
    onCompleted = jest.fn().mockResolvedValue(undefined);
  });

  it('keeps files at the 50 MiB threshold on the existing single request endpoint', async () => {
    (jest.mocked(adminService.batchUploadProblems) as jest.Mock).mockResolvedValueOnce({ progressId: 'small-job' });
    const source = makeEventSource();
    (jest.mocked(adminService.getBatchUploadProgressEventSource) as jest.Mock).mockReturnValueOnce(source);
    const { result } = renderHook(() => useBatchUpload({ onCompleted, setLoading }));

    await chooseFile(result, makeFile(50 * 1024 * 1024));

    expect(adminService.batchUploadProblems).toHaveBeenCalledTimes(1);
    const formData = jest.mocked(adminService.batchUploadProblems).mock.calls[0][0];
    expect(formData.get('problemsZip')).toBeInstanceOf(File);
    expect(adminService.initBatchUpload).not.toHaveBeenCalled();
    expect(adminService.uploadBatchUploadChunk).not.toHaveBeenCalled();
    expect(adminService.getBatchUploadProgressEventSource).toHaveBeenCalledWith('small-job');
  });

  it('uploads files over 50 MiB in ordered 25 MiB chunks and reports part progress before SSE', async () => {
    const partSize = 25 * 1024 * 1024;
    const file = makeFile(partSize * 2 + 10);
    const source = makeEventSource();
    const uploadEvents: string[] = [];
    let activeChunks = 0;
    let maxConcurrentChunks = 0;
    (jest.mocked(adminService.initBatchUpload) as jest.Mock).mockResolvedValueOnce({ uploadId: 'upload-1' });
    (jest.mocked(adminService.uploadBatchUploadChunk) as jest.Mock).mockImplementation(async (_uploadId, chunkIndex) => {
      uploadEvents.push(`chunk-${chunkIndex}`);
      activeChunks += 1;
      maxConcurrentChunks = Math.max(maxConcurrentChunks, activeChunks);
      await Promise.resolve();
      activeChunks -= 1;
      return { success: true, chunkIndex };
    });
    (jest.mocked(adminService.completeBatchUpload) as jest.Mock).mockImplementationOnce(async () => {
      uploadEvents.push('complete');
      return { progressId: 'large-job' };
    });
    (jest.mocked(adminService.getBatchUploadProgressEventSource) as jest.Mock).mockImplementationOnce(() => {
      uploadEvents.push('sse');
      return source;
    });
    const { result } = renderHook(() => useBatchUpload({ onCompleted, setLoading }));

    await chooseFile(result, file);

    expect(adminService.batchUploadProblems).not.toHaveBeenCalled();
    expect(adminService.initBatchUpload).toHaveBeenCalledWith({
      fileName: 'problems.zip', fileSize: partSize * 2 + 10, totalChunks: 3,
    });
    expect(jest.mocked(adminService.uploadBatchUploadChunk).mock.calls.map((call) => call.slice(1, 2))).toEqual([[0], [1], [2]]);
    expect((file.slice as jest.Mock).mock.calls).toEqual([[0, partSize], [partSize, partSize * 2], [partSize * 2, partSize * 2 + 10]]);
    expect(result.current.batchUploadFeedback.message).toContain('3/3');
    expect(result.current.batchUploadFeedback.message).toContain('100%');
    expect(maxConcurrentChunks).toBe(1);
    expect(uploadEvents).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'complete', 'sse']);
    expect(adminService.completeBatchUpload).toHaveBeenCalledWith('upload-1');
    expect(adminService.getBatchUploadProgressEventSource).toHaveBeenCalledWith('large-job');
  });

  it('uses the same exact chunk count for an exact multiple without an empty remainder', async () => {
    const partSize = 25 * 1024 * 1024;
    const file = makeFile(partSize * 3);
    (jest.mocked(adminService.initBatchUpload) as jest.Mock).mockResolvedValueOnce({ uploadId: 'upload-exact' });
    (jest.mocked(adminService.uploadBatchUploadChunk) as jest.Mock).mockResolvedValue({ success: true, chunkIndex: 0 });
    (jest.mocked(adminService.completeBatchUpload) as jest.Mock).mockResolvedValueOnce({ progressId: 'exact-job' });
    (jest.mocked(adminService.getBatchUploadProgressEventSource) as jest.Mock).mockReturnValueOnce(makeEventSource());
    const { result } = renderHook(() => useBatchUpload({ onCompleted, setLoading }));

    await chooseFile(result, file);

    expect(adminService.initBatchUpload).toHaveBeenCalledWith({ fileName: 'problems.zip', fileSize: partSize * 3, totalChunks: 3 });
    expect(adminService.uploadBatchUploadChunk).toHaveBeenCalledTimes(3);
    expect(file.slice).toHaveBeenCalledTimes(3);
  });

  it('does not complete or subscribe when a chunk fails, and leaves a retryable error', async () => {
    (jest.mocked(adminService.initBatchUpload) as jest.Mock).mockResolvedValueOnce({ uploadId: 'upload-fail' });
    (jest.mocked(adminService.uploadBatchUploadChunk) as jest.Mock)
      .mockResolvedValueOnce({ success: true, chunkIndex: 0 })
      .mockRejectedValueOnce(new Error('chunk rejected'));
    const { result } = renderHook(() => useBatchUpload({ onCompleted, setLoading }));
    const input = document.createElement('input');
    result.current.batchUploadInputRef.current = input;

    await chooseFile(result, makeFile(50 * 1024 * 1024 + 1));

    expect(adminService.uploadBatchUploadChunk).toHaveBeenCalledTimes(2);
    expect(adminService.completeBatchUpload).not.toHaveBeenCalled();
    expect(adminService.getBatchUploadProgressEventSource).not.toHaveBeenCalled();
    expect(result.current.batchUploadFeedback).toMatchObject({ type: 'error', message: 'chunk rejected' });
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(input.value).toBe('');
  });

  it('refreshes and releases loading once when a late duplicate SSE terminal event arrives', async () => {
    const source = makeEventSource();
    (jest.mocked(adminService.batchUploadProblems) as jest.Mock).mockResolvedValueOnce({ progressId: 'terminal-job' });
    (jest.mocked(adminService.getBatchUploadProgressEventSource) as jest.Mock).mockReturnValueOnce(source);
    const { result } = renderHook(() => useBatchUpload({ onCompleted, setLoading }));
    await chooseFile(result, makeFile(1));

    await act(async () => {
      source.emit('complete', JSON.stringify({ added: ['P1'], skipped: [], message: 'Done' }));
      source.emit('error', JSON.stringify({ message: 'late stale error' }));
    });

    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
    expect(result.current.batchUploadFeedback.type).toBe('success');
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it('rejects files above 2 GiB before making a request and resets the file input', async () => {
    const { result } = renderHook(() => useBatchUpload({ onCompleted, setLoading }));
    const input = document.createElement('input');
    result.current.batchUploadInputRef.current = input;
    const file = makeFile(2 * 1024 * 1024 * 1024 + 1);

    await chooseFile(result, file);

    expect(adminService.batchUploadProblems).not.toHaveBeenCalled();
    expect(adminService.initBatchUpload).not.toHaveBeenCalled();
    expect(result.current.batchUploadFeedback.type).toBe('error');
    expect(input.value).toBe('');
  });

  it('resets the file input after a successful upload begins processing', async () => {
    const source = makeEventSource();
    (jest.mocked(adminService.batchUploadProblems) as jest.Mock).mockResolvedValueOnce({ progressId: 'reset-job' });
    (jest.mocked(adminService.getBatchUploadProgressEventSource) as jest.Mock).mockReturnValueOnce(source);
    const { result } = renderHook(() => useBatchUpload({ onCompleted, setLoading }));
    const input = document.createElement('input');
    result.current.batchUploadInputRef.current = input;

    await chooseFile(result, makeFile(1));

    expect(input.value).toBe('');
    expect(setLoading).toHaveBeenCalledWith(true);
  });
});
