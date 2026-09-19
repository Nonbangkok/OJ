import { renderHook, act, waitFor } from '@testing-library/react';
import useProblemCrud from '../../../hooks/admin/useProblemCrud';
import adminService from '../../../services/adminService';

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

    const mockProblems = [
        { id: 'PROB1', title: 'Problem 1', author: 'admin', is_visible: true },
    ];

    it('fetches problems on mount', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(mockProblems);

        const { result } = renderHook(() => useProblemCrud());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.problems).toEqual(mockProblems);
    });

    it('stops upload-progress polling when the job completes', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockProblems);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW1' });
        (jest.mocked(adminService.uploadFiles) as jest.Mock).mockResolvedValueOnce({ jobId: 'job-1' });
        (jest.mocked(adminService.getUploadProgress) as jest.Mock)
            .mockResolvedValueOnce({ status: 'uploading', message: 'Working...' })
            .mockResolvedValueOnce({ status: 'completed', message: 'Done' });

        const { result } = renderHook(() => useProblemCrud());

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
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockProblems);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW1' });
        (jest.mocked(adminService.uploadFiles) as jest.Mock).mockResolvedValueOnce({ jobId: 'job-2' });
        (jest.mocked(adminService.getUploadProgress) as jest.Mock).mockResolvedValue({ status: 'uploading', message: 'Stuck...' });

        const { result } = renderHook(() => useProblemCrud());

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
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockProblems);
        (jest.mocked(adminService.createProblem) as jest.Mock).mockResolvedValueOnce({ id: 'NEW1' });
        (jest.mocked(adminService.uploadFiles) as jest.Mock).mockResolvedValueOnce({ jobId: 'job-3' });
        (jest.mocked(adminService.getUploadProgress) as jest.Mock).mockResolvedValue({ status: 'uploading', message: 'Working...' });

        const { result, unmount } = renderHook(() => useProblemCrud());

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
