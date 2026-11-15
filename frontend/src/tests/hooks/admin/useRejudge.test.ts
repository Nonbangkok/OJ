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

    describe('bulk problem rejudge', () => {
        const bulk = { kind: 'problems' as const, ids: ['P1', 'P2', 'P3'], title: 'the 3 selected problems' };

        const confirmBulk = async () => {
            const { result } = renderHook(() => useRejudge());
            act(() => {
                result.current.handleRejudgeClick(bulk);
            });
            await act(async () => {
                await result.current.handleConfirmRejudge();
            });
            return result;
        };

        it('rejudges every selected problem and reports the combined counts', async () => {
            (jest.mocked(adminService.rejudgeProblem) as jest.Mock)
                .mockResolvedValueOnce({ queued: 2, skipped: 1 })
                .mockResolvedValueOnce({ queued: 3, skipped: 0, busy: 1 })
                .mockResolvedValueOnce({ queued: 0, skipped: 0 });

            const result = await confirmBulk();

            expect(adminService.rejudgeProblem).toHaveBeenCalledTimes(3);
            expect(adminService.rejudgeProblem).toHaveBeenNthCalledWith(1, 'P1');
            expect(adminService.rejudgeProblem).toHaveBeenNthCalledWith(2, 'P2');
            expect(adminService.rejudgeProblem).toHaveBeenNthCalledWith(3, 'P3');
            expect(result.current.rejudgeFeedback).toEqual({
                visible: true,
                message: 'Rejudge queued for 5 submissions across 3 problems (1 skipped — no stored code) (1 already being judged — skipped).',
                type: 'success',
            });
        });

        it('keeps going after a failure and names the problems that failed', async () => {
            (jest.mocked(adminService.rejudgeProblem) as jest.Mock)
                .mockResolvedValueOnce({ queued: 2, skipped: 0 })
                .mockRejectedValueOnce({ response: { status: 500, data: { message: 'Server exploded.' } } })
                .mockResolvedValueOnce({ queued: 1, skipped: 0 });

            const result = await confirmBulk();

            expect(adminService.rejudgeProblem).toHaveBeenCalledTimes(3);
            expect(result.current.rejudgeFeedback).toEqual({
                visible: true,
                message: 'Rejudge queued for 3 submissions across 2 problems. 1 of 3 problems failed: P2 (Server exploded.).',
                type: 'error',
            });
        });

        it('reports when every selected problem failed', async () => {
            (jest.mocked(adminService.rejudgeProblem) as jest.Mock)
                .mockRejectedValue({ response: { status: 500, data: { message: 'Down.' } } });

            const result = await confirmBulk();

            expect(result.current.rejudgeFeedback).toEqual({
                visible: true,
                message: '3 of 3 problems failed: P1 (Down.), P2 (Down.), P3 (Down.).',
                type: 'error',
            });
        });

        it('says nothing was rejudged when no selected problem had judgeable submissions', async () => {
            (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockResolvedValue({ queued: 0, skipped: 0 });

            const result = await confirmBulk();

            expect(result.current.rejudgeFeedback).toEqual({
                visible: true,
                message: 'No judgeable submissions found for the 3 selected problems. Nothing was rejudged.',
                type: 'info',
            });
        });
    });
});
