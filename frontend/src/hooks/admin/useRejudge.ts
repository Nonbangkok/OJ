import { useCallback, useState } from 'react';

import adminService from '../../services/adminService';
import type { RejudgeResponse } from '../../types';
import { getErrorMessage } from '../../utils/error';

/** What a "Rejudge" button points at: one problem, one contest, or a
 *  selection of problems (rejudged one by one through the per-problem call —
 *  there is no bulk endpoint). */
export type RejudgeTarget =
  | { kind: 'problem' | 'contest'; id: string | number; title: string }
  | { kind: 'problems'; ids: Array<string | number>; title: string };

export interface RejudgeFeedback {
  visible: boolean;
  message: string;
  type: 'info' | 'success' | 'error';
}

const HIDDEN_FEEDBACK: RejudgeFeedback = { visible: false, message: '', type: 'info' };

const buildFeedback = (target: RejudgeTarget, result: RejudgeResponse, scope = ''): RejudgeFeedback => {
  if (result.queued === 0) {
    return {
      visible: true,
      message: `No judgeable submissions found for ${target.title}. Nothing was rejudged.`,
      type: 'info',
    };
  }
  const skippedSuffix = result.skipped > 0
    ? ` (${result.skipped} skipped — no stored code)`
    : '';
  const busySuffix = result.busy && result.busy > 0
    ? ` (${result.busy} already being judged — skipped)`
    : '';
  return {
    visible: true,
    message: `Rejudge queued for ${result.queued} submissions${scope}${skippedSuffix}${busySuffix}.`,
    type: 'success',
  };
};

/** Rejudges each selected problem in turn. One failure does not stop the
 *  rest; the feedback sums what was queued and names every problem that
 *  failed. */
const rejudgeProblems = async (
  target: Extract<RejudgeTarget, { kind: 'problems' }>
): Promise<RejudgeFeedback> => {
  const totals = { queued: 0, skipped: 0, busy: 0 };
  const failures: string[] = [];
  for (const id of target.ids) {
    try {
      const result = await adminService.rejudgeProblem(id);
      totals.queued += result.queued;
      totals.skipped += result.skipped;
      totals.busy += result.busy ?? 0;
    } catch (errorValue) {
      failures.push(`${id} (${getErrorMessage(errorValue, 'Failed to rejudge problem.')})`);
      console.error(`Error triggering rejudge for problem ${id}:`, errorValue);
    }
  }

  const succeeded = target.ids.length - failures.length;
  const scope = ` across ${succeeded} ${succeeded === 1 ? 'problem' : 'problems'}`;
  if (failures.length === 0) {
    return buildFeedback(target, totals, scope);
  }
  const failedPart = `${failures.length} of ${target.ids.length} problems failed: ${failures.join(', ')}.`;
  return {
    visible: true,
    message: totals.queued > 0
      ? `${buildFeedback(target, totals, scope).message} ${failedPart}`
      : failedPart,
    type: 'error',
  };
};

/** Shared confirm-dialog + feedback state for the per-problem and per-contest
 *  Rejudge actions in the admin panels. */
const useRejudge = () => {
  const [isRejudgeConfirmOpen, setIsRejudgeConfirmOpen] = useState(false);
  const [rejudgeTarget, setRejudgeTarget] = useState<RejudgeTarget | null>(null);
  const [isRejudging, setIsRejudging] = useState(false);
  const [rejudgeFeedback, setRejudgeFeedback] = useState<RejudgeFeedback>(HIDDEN_FEEDBACK);

  const handleRejudgeClick = useCallback((target: RejudgeTarget) => {
    setRejudgeTarget(target);
    setIsRejudgeConfirmOpen(true);
  }, []);

  const handleCloseRejudgeConfirm = useCallback(() => {
    setIsRejudgeConfirmOpen(false);
    setRejudgeTarget(null);
  }, []);

  const handleConfirmRejudge = useCallback(async (): Promise<void> => {
    if (!rejudgeTarget || isRejudging) {
      return;
    }

    setIsRejudging(true);
    try {
      if (rejudgeTarget.kind === 'problems') {
        setRejudgeFeedback(await rejudgeProblems(rejudgeTarget));
      } else {
        const result = rejudgeTarget.kind === 'problem'
          ? await adminService.rejudgeProblem(rejudgeTarget.id)
          : await adminService.rejudgeContest(rejudgeTarget.id);
        setRejudgeFeedback(buildFeedback(rejudgeTarget, result));
      }
    } catch (errorValue) {
      const fallback = rejudgeTarget.kind === 'contest'
        ? 'Failed to rejudge contest.'
        : 'Failed to rejudge problem.';
      setRejudgeFeedback({ visible: true, message: getErrorMessage(errorValue, fallback), type: 'error' });
      console.error('Error triggering rejudge:', errorValue);
    } finally {
      setIsRejudging(false);
      setIsRejudgeConfirmOpen(false);
      setRejudgeTarget(null);
    }
  }, [rejudgeTarget, isRejudging]);

  const dismissRejudgeFeedback = useCallback(() => {
    setRejudgeFeedback(HIDDEN_FEEDBACK);
  }, []);

  return {
    isRejudgeConfirmOpen,
    rejudgeTarget,
    isRejudging,
    rejudgeFeedback,
    handleRejudgeClick,
    handleCloseRejudgeConfirm,
    handleConfirmRejudge,
    dismissRejudgeFeedback,
  };
};

export default useRejudge;
