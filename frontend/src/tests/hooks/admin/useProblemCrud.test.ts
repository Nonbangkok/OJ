import { renderHook, act, waitFor } from '@testing-library/react';
import useProblemCrud from '../../../hooks/admin/useProblemCrud';
import adminService from '../../../services/adminService';
import { CHUNKED_UPLOAD_CONFIG } from '../../../config/upload';

jest.mock('../../../services/adminService');

jest.useFakeTimers({ now: Date.now() });

describe('useProblemCrud', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
    });

    const mockPage = {
        problems: [{ id: 'PROB1', title: 'Problem 1', author: 'admin', is_visible: true }],
        nextCursor: null,
        hasMore: false,
        authors: [{ name: 'admin' }],
        hasUnauthoredProblems: false,
    };
    const mockProblems = mockPage.problems;

    it('fetches problems on mount', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);

        const { result } = renderHook(() => useProblemCrud({ query: {} }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.problems).toEqual(mockProblems);
    });

    it('uses the update endpoint for an Edit Problem modal save', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);
        (jest.mocked(adminService.getProblemDetail) as jest.Mock).mockResolvedValue({
            id: 'PROB1', title: 'Problem 1', author: 'admin', time_limit_ms: 1000, memory_limit_mb: 256,
        });
        (jest.mocked(adminService.updateProblem) as jest.Mock).mockResolvedValue({});

        const { result } = renderHook(() => useProblemCrud({ query: {} }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleEdit(mockProblems[0] as never);
        });
        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'PROB1', title: 'Changed', author: 'admin', time_limit_ms: 2500, memory_limit_mb: 768 },
                pdfFile: null,
                zipFile: null,
            }, true);
        });

        expect(adminService.updateProblem).toHaveBeenCalledWith('PROB1', expect.objectContaining({
            time_limit_ms: 2500,
            memory_limit_mb: 768,
        }));
        expect(adminService.createProblem).not.toHaveBeenCalled();
    });

    it('uploads a large Test Cases ZIP as 25 MiB chunks on problem creation', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW1' });
        (jest.mocked(adminService.initProblemTestcaseUpload) as jest.Mock).mockResolvedValueOnce({ uploadId: 'upload-1' });
        (jest.mocked(adminService.uploadProblemTestcaseChunk) as jest.Mock).mockResolvedValue({ success: true, chunkIndex: 0 });
        (jest.mocked(adminService.completeProblemTestcaseUpload) as jest.Mock)
            .mockResolvedValueOnce({ message: 'done', insertedCount: 4 });

        const zipFile = new File(['small test fixture'], 'testcases.zip', { type: 'application/zip' });
        Object.defineProperty(zipFile, 'size', { value: CHUNKED_UPLOAD_CONFIG.singleRequestLimitBytes + 1 });
        jest.spyOn(zipFile, 'slice').mockReturnValue(new Blob(['chunk']));

        const { result } = renderHook(() => useProblemCrud({ query: {} }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'NEW1', title: 'T', author: 'a', time_limit_ms: 1000, memory_limit_mb: 256 },
                pdfFile: null,
                zipFile,
            });
        });

        const expectedChunkCount = Math.ceil((CHUNKED_UPLOAD_CONFIG.singleRequestLimitBytes + 1)
            / CHUNKED_UPLOAD_CONFIG.chunkSizeBytes);
        expect(adminService.initProblemTestcaseUpload).toHaveBeenCalledWith('NEW1', {
            fileName: 'testcases.zip',
            fileSize: CHUNKED_UPLOAD_CONFIG.singleRequestLimitBytes + 1,
            totalChunks: expectedChunkCount,
        });
        expect(adminService.uploadProblemTestcaseChunk).toHaveBeenCalledTimes(expectedChunkCount);
        expect(zipFile.slice).toHaveBeenNthCalledWith(1, 0, CHUNKED_UPLOAD_CONFIG.chunkSizeBytes);
        expect(adminService.completeProblemTestcaseUpload).toHaveBeenCalledWith('NEW1', 'upload-1');
        expect(adminService.uploadFiles).not.toHaveBeenCalled();
        expect(result.current.isModalOpen).toBe(false);
    });

    it('uploads a large Test Cases ZIP as chunks on problem edit', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);
        (jest.mocked(adminService.getProblemDetail) as jest.Mock).mockResolvedValue({
            id: 'PROB1', title: 'Problem 1', author: 'admin', time_limit_ms: 1000, memory_limit_mb: 256,
        });
        (jest.mocked(adminService.updateProblem) as jest.Mock).mockResolvedValueOnce({});
        (jest.mocked(adminService.initProblemTestcaseUpload) as jest.Mock).mockResolvedValueOnce({ uploadId: 'edit-upload' });
        (jest.mocked(adminService.uploadProblemTestcaseChunk) as jest.Mock).mockResolvedValue({ success: true, chunkIndex: 0 });
        (jest.mocked(adminService.completeProblemTestcaseUpload) as jest.Mock)
            .mockResolvedValueOnce({ message: 'done', insertedCount: 4 });

        const zipFile = new File(['small test fixture'], 'testcases.zip', { type: 'application/zip' });
        Object.defineProperty(zipFile, 'size', { value: CHUNKED_UPLOAD_CONFIG.singleRequestLimitBytes + 1 });
        jest.spyOn(zipFile, 'slice').mockReturnValue(new Blob(['chunk']));

        const { result } = renderHook(() => useProblemCrud({ query: {} }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => result.current.handleEdit(mockProblems[0] as never));
        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'PROB1', title: 'Changed', author: 'admin', time_limit_ms: 1000, memory_limit_mb: 256 },
                pdfFile: null,
                zipFile,
            }, true);
        });

        expect(adminService.updateProblem).toHaveBeenCalledWith('PROB1', expect.objectContaining({ title: 'Changed' }));
        expect(adminService.initProblemTestcaseUpload).toHaveBeenCalledWith('PROB1', expect.objectContaining({
            fileName: 'testcases.zip', totalChunks: 3,
        }));
        expect(adminService.uploadProblemTestcaseChunk).toHaveBeenCalledTimes(3);
        expect(adminService.completeProblemTestcaseUpload).toHaveBeenCalledWith('PROB1', 'edit-upload');
        expect(adminService.uploadFiles).not.toHaveBeenCalled();
    });

    it('keeps smaller Test Cases ZIP uploads on the existing multipart endpoint', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW2' });
        (jest.mocked(adminService.uploadFiles) as jest.Mock).mockResolvedValueOnce({});
        const zipFile = new File(['tiny zip'], 'testcases.zip', { type: 'application/zip' });

        const { result } = renderHook(() => useProblemCrud({ query: {} }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'NEW2', title: 'T', author: 'a', time_limit_ms: 1000, memory_limit_mb: 256 },
                pdfFile: null,
                zipFile,
            });
        });

        expect(adminService.uploadFiles).toHaveBeenCalledTimes(1);
        const formData = (jest.mocked(adminService.uploadFiles).mock.calls[0][1]);
        expect(formData.get('testcasesZip')).toBe(zipFile);
        expect(adminService.initProblemTestcaseUpload).not.toHaveBeenCalled();
    });

    it('refuses to create a problem when the modal says edit but no target is available', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);

        const { result } = renderHook(() => useProblemCrud({ query: {} }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'PROB1', title: 'Changed', author: 'admin', time_limit_ms: 2500, memory_limit_mb: 768 },
                pdfFile: null,
                zipFile: null,
            }, true);
        });

        expect(adminService.createProblem).not.toHaveBeenCalled();
        expect(adminService.updateProblem).not.toHaveBeenCalled();
        expect(result.current.error).toMatch(/identify the problem to update/i);
    });

    it('stops upload-progress polling when the job completes', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW1' });
        (jest.mocked(adminService.uploadFiles) as jest.Mock).mockResolvedValueOnce({ jobId: 'job-1' });
        (jest.mocked(adminService.getUploadProgress) as jest.Mock)
            .mockResolvedValueOnce({ status: 'uploading', message: 'Working...' })
            .mockResolvedValueOnce({ status: 'completed', message: 'Done' });

        const { result } = renderHook(() => useProblemCrud({ query: {} }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'NEW1', title: 'T', author: 'a', time_limit_ms: 1000, memory_limit_mb: 256 },
                pdfFile: new File(['x'], 'x.pdf'),
                zipFile: null,
            });
        });

        // First poll: still uploading → interval keeps running
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });
        expect(adminService.getUploadProgress).toHaveBeenCalledTimes(1);

        // Second poll: completed → interval stops, modal closes, list refetched
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });
        expect(adminService.getUploadProgress).toHaveBeenCalledTimes(2);

        await act(async () => {
            jest.advanceTimersByTime(10000);
        });
        expect(adminService.getUploadProgress).toHaveBeenCalledTimes(2);
        expect(result.current.isModalOpen).toBe(false);
        expect(result.current.uploadProgress).toBeNull();
    });

    it('stops polling after the max-duration ceiling even if the job never finishes', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW1' });
        (jest.mocked(adminService.uploadFiles) as jest.Mock).mockResolvedValueOnce({ jobId: 'job-2' });
        (jest.mocked(adminService.getUploadProgress) as jest.Mock).mockResolvedValue({ status: 'uploading', message: 'Stuck...' });

        const { result } = renderHook(() => useProblemCrud({ query: {} }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'NEW1', title: 'T', author: 'a', time_limit_ms: 1000, memory_limit_mb: 256 },
                pdfFile: new File(['x'], 'x.pdf'),
                zipFile: null,
            });
        });

        // Advance past the max-attempts ceiling (300 polls at 2s each).
        // advanceTimersByTime fires each scheduled interval callback, but each
        // async callback re-schedules itself out-of-band — loop tick-by-tick
        // and flush microtasks so every attempt is counted in order.
        for (let i = 0; i < 302; i++) {
            await act(async () => {
                jest.advanceTimersByTime(2000);
            });
        }

        const callsAfterCeiling = (adminService.getUploadProgress as jest.Mock).mock.calls.length;
        expect(callsAfterCeiling).toBe(300);
        expect(result.current.uploadProgress?.status).toBe('failed');
        expect(result.current.error).toBe('Upload processing timed out.');

        await act(async () => {
            jest.advanceTimersByTime(20000);
        });
        expect((adminService.getUploadProgress as jest.Mock).mock.calls.length).toBe(callsAfterCeiling);
    });

    it('stops polling and never setStates after unmount', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockPage);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW1' });
        (jest.mocked(adminService.uploadFiles) as jest.Mock).mockResolvedValueOnce({ jobId: 'job-3' });
        (jest.mocked(adminService.getUploadProgress) as jest.Mock).mockResolvedValue({ status: 'uploading', message: 'Working...' });

        const { result, unmount } = renderHook(() => useProblemCrud({ query: {} }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleSave({
                problemData: { id: 'NEW1', title: 'T', author: 'a', time_limit_ms: 1000, memory_limit_mb: 256 },
                pdfFile: new File(['x'], 'x.pdf'),
                zipFile: null,
            });
        });

        unmount();

        // No error/warning despite firing timers after unmount
        await act(async () => {
            jest.advanceTimersByTime(60000);
        });
    });
});
