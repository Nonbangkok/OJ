import { useCallback, useState } from 'react';

import adminService from '../../services/adminService';
import type { RejudgeResponse } from '../../types';
import { getErrorMessage } from '../../utils/error';

/** What a "Rejudge" button points at: one problem or one contest. */
export interface RejudgeTarget {
  kind: 'problem' | 'contest';
  id: string | number;
  title: string;
}

export interface RejudgeFeedback {
  visible: boolean;
  message: string;
  type: 'info' | 'success' | 'error';
}

const HIDDEN_FEEDBACK: RejudgeFeedback = { visible: false, message: '', type: 'info' };

const buildFeedback = (target: RejudgeTarget, result: RejudgeResponse): RejudgeFeedback => {
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
  return {
    visible: true,
    message: `Rejudge queued for ${result.queued} submissions${skippedSuffix}.`,
    type: 'success',
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
      const result = rejudgeTarget.kind === 'problem'
        ? await adminService.rejudgeProblem(rejudgeTarget.id)
        : await adminService.rejudgeContest(rejudgeTarget.id);
      setRejudgeFeedback(buildFeedback(rejudgeTarget, result));
    } catch (errorValue) {
      const fallback = rejudgeTarget.kind === 'problem'
        ? 'Failed to rejudge problem.'
        : 'Failed to rejudge contest.';
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
