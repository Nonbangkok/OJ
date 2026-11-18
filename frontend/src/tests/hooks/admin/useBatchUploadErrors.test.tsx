import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import useBatchUpload from '../../../hooks/admin/useBatchUpload';
import { buildBatchUploadCompleteFeedback } from '../../../hooks/admin/problemManagement.helpers';
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
  return {
    addEventListener: jest.fn((name: string, listener: (event: MessageEvent<string>) => void) => {
      listeners.set(name, listener);
    }),
    close: jest.fn(),
    emit: (name, data) => listeners.get(name)?.({ data } as MessageEvent<string>),
  };
};

const makeFile = (): File => {
  const file = new File([], 'problems.zip', { type: 'application/zip' });
  Object.defineProperty(file, 'size', { value: 1 });
  return file;
};

/** Starts a small (single-request) upload and returns the SSE source the hook subscribed to. */
const startUpload = async (onCompleted: jest.Mock, setLoading: jest.Mock) => {
  const source = makeEventSource();
  (jest.mocked(adminService.batchUploadProblems) as jest.Mock).mockResolvedValueOnce({ progressId: 'job-1' });
  (jest.mocked(adminService.getBatchUploadProgressEventSource) as jest.Mock).mockReturnValueOnce(source);
  const hook = renderHook(() => useBatchUpload({ onCompleted, setLoading }));
  hook.result.current.batchUploadInputRef.current = document.createElement('input');
  await act(async () => {
    await hook.result.current.handleBatchUploadFileChange(
      { target: { files: [makeFile()] } } as unknown as ChangeEvent<HTMLInputElement>,
    );
  });
  return { ...hook, source };
};

/**
 * The SSE 'complete' event carries results.errors: every per-problem rejection
 * and any archive-level failure (zip-slip, entry or size caps). The banner must
 * name them instead of reading as a green success.
 */
describe('useBatchUpload complete event with import errors', () => {
  let setLoading: jest.Mock;
  let onCompleted: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    setLoading = jest.fn();
    onCompleted = jest.fn().mockResolvedValue(undefined);
  });

  it('does not report green success when some problems were rejected, and names each rejection', async () => {
    const { result, source } = await startUpload(onCompleted, setLoading);

    await act(async () => {
      source.emit('complete', JSON.stringify({
        status: 'complete',
        message: 'Batch upload process finished.',
        added: ['H1', 'H2', 'H3', 'H4'],
        skipped: [],
        errors: [{ directory: 'H5', message: 'Problem "H5": Grader files must include at least one .cpp file.' }],
      }));
    });

    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
    const feedback = result.current.batchUploadFeedback;
    expect(feedback.type).toBe('error');
    expect(feedback.message).toContain('Added 4 problems, skipped 0 problems.');
    expect(feedback.message).toContain('H5: Problem "H5": Grader files must include at least one .cpp file.');
  });

  it('reports an archive-level rejection (no problems added) as a failure with its reason', async () => {
    const { result, source } = await startUpload(onCompleted, setLoading);

    await act(async () => {
      source.emit('complete', JSON.stringify({
        status: 'complete',
        message: 'Batch upload process finished.',
        added: [],
        skipped: [],
        errors: [{ directory: 'Batch Process', message: 'Archive rejected: uncompressed size exceeds 524288000 bytes (decompression bomb).' }],
      }));
    });

    await waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
    const feedback = result.current.batchUploadFeedback;
    expect(feedback.type).toBe('error');
    expect(feedback.message).toContain('Added 0 problems');
    expect(feedback.message).toContain('Archive rejected: uncompressed size exceeds 524288000 bytes (decompression bomb).');
  });

  it('still reports success when the complete event carries an empty errors list', async () => {
    const { result, source } = await startUpload(onCompleted, setLoading);

    await act(async () => {
      source.emit('complete', JSON.stringify({
        status: 'complete', message: 'Batch upload process finished.', added: ['P1'], skipped: ['P2'], errors: [],
      }));
    });

    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
    expect(result.current.batchUploadFeedback).toEqual({
      visible: true, type: 'success', message: 'Batch upload complete. Added 1 problems, skipped 1 problems.',
    });
  });
});

describe('buildBatchUploadCompleteFeedback', () => {
  it('lists every error as directory: message', () => {
    expect(buildBatchUploadCompleteFeedback({
      added: ['A'],
      skipped: [],
      errors: [{ directory: 'B', message: 'bad config' }, { directory: 'C', message: 'no testcases' }],
    })).toEqual({
      type: 'error',
      message: 'Batch upload finished with 2 errors. Added 1 problems, skipped 0 problems. Errors: B: bad config; C: no testcases',
    });
  });

  it('falls back to the server message when the counts are missing and nothing failed', () => {
    expect(buildBatchUploadCompleteFeedback({ message: 'Batch upload process finished.' }))
      .toEqual({ type: 'success', message: 'Batch upload process finished.' });
  });
});
