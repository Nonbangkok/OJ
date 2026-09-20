import { renderHook, act, waitFor } from '@testing-library/react';
import useRejudge from '../../../hooks/admin/useRejudge';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useRejudge', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const target = { kind: 'problem' as const, id: 'P1', title: 'Problem 1' };

    it('opens the confirm dialog for a target and closes it on cancel', () => {
        const { result } = renderHook(() => useRejudge());

        expect(result.current.isRejudgeConfirmOpen).toBe(false);

        act(() => {
            result.current.handleRejudgeClick(target);
        });

        expect(result.current.isRejudgeConfirmOpen).toBe(true);
        expect(result.current.rejudgeTarget).toEqual(target);

        act(() => {
            result.current.handleCloseRejudgeConfirm();
        });

        expect(result.current.isRejudgeConfirmOpen).toBe(false);
        expect(result.current.rejudgeTarget).toBeNull();
        expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
    });

    it('calls the rejudge service on confirm and reports queued/skipped counts', async () => {
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockResolvedValueOnce({ queued: 4, skipped: 1 });

        const { result } = renderHook(() => useRejudge());

        act(() => {
            result.current.handleRejudgeClick(target);
        });

        await act(async () => {
            await result.current.handleConfirmRejudge();
        });

        expect(adminService.rejudgeProblem).toHaveBeenCalledWith('P1');
        expect(result.current.isRejudgeConfirmOpen).toBe(false);
        expect(result.current.rejudgeTarget).toBeNull();
        expect(result.current.rejudgeFeedback).toEqual({
            visible: true,
            message: 'Rejudge queued for 4 submissions (1 skipped — no stored code).',
            type: 'success',
        });
    });

    it('omits the skipped clause when nothing was skipped', async () => {
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockResolvedValueOnce({ queued: 3, skipped: 0 });

        const { result } = renderHook(() => useRejudge());

        act(() => {
            result.current.handleRejudgeClick(target);
        });

        await act(async () => {
            await result.current.handleConfirmRejudge();
        });

        expect(result.current.rejudgeFeedback.message).toBe('Rejudge queued for 3 submissions.');
        expect(result.current.rejudgeFeedback.type).toBe('success');
    });

    it('surfaces an info message when nothing was queued', async () => {
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockResolvedValueOnce({ queued: 0, skipped: 0 });

        const { result } = renderHook(() => useRejudge());

        act(() => {
            result.current.handleRejudgeClick(target);
        });

        await act(async () => {
            await result.current.handleConfirmRejudge();
        });

        expect(result.current.rejudgeFeedback.type).toBe('info');
    });

    it('shows an error message when the rejudge request fails', async () => {
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockRejectedValueOnce({
            response: { status: 409, data: { message: 'This contest is finished and its scoreboard is frozen.' } },
        });

        const { result } = renderHook(() => useRejudge());

        act(() => {
            result.current.handleRejudgeClick(target);
        });

        await act(async () => {
            await result.current.handleConfirmRejudge();
        });

        expect(result.current.rejudgeFeedback).toEqual({
            visible: true,
            message: 'This contest is finished and its scoreboard is frozen.',
            type: 'error',
        });
    });

    it('dismisses the feedback box', async () => {
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockResolvedValueOnce({ queued: 1, skipped: 0 });

        const { result } = renderHook(() => useRejudge());

        act(() => {
            result.current.handleRejudgeClick(target);
        });
        await act(async () => {
            await result.current.handleConfirmRejudge();
        });

        expect(result.current.rejudgeFeedback.visible).toBe(true);

        act(() => {
            result.current.dismissRejudgeFeedback();
        });

        expect(result.current.rejudgeFeedback.visible).toBe(false);
    });

    it('tracks the pending state while the request is in flight', async () => {
        let resolveRequest: (value: { queued: number; skipped: number }) => void = () => {};
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockImplementationOnce(
            () => new Promise((resolve) => { resolveRequest = resolve; })
        );

        const { result } = renderHook(() => useRejudge());

        act(() => {
            result.current.handleRejudgeClick(target);
        });

        let confirmPromise: Promise<void> = Promise.resolve();
        act(() => {
            confirmPromise = result.current.handleConfirmRejudge();
        });
        expect(result.current.isRejudging).toBe(true);

        await act(async () => {
            resolveRequest({ queued: 2, skipped: 0 });
            await confirmPromise;
        });

        expect(result.current.isRejudging).toBe(false);
    });
});
