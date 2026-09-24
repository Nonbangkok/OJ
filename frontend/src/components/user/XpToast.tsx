import { useEffect, useState } from 'react';

import { SUBMISSION_STATUS } from '../../utils/constants';
import type { SubmissionUpdatePayload } from '../../services/realtimeService';

import styles from './XpToast.module.css';

/** How long the toast stays on screen before fading out. */
const DISMISS_AFTER_MS = 4000;

interface XpToastProps {
  /** Latest realtime submission event; null while no stream event has arrived. */
  event: SubmissionUpdatePayload | null;
}

/**
 * "+N XP" toast for a first-solve Accepted verdict.
 *
 * Renders only when the latest realtime event carries a positive `xp_awarded`
 * (the backend sets it solely on the Accepted transition that created a NEW
 * first-solve reward) — re-solves and rejudges of an already-solved problem
 * never trigger it. Auto-dismisses after {@link DISMISS_AFTER_MS}; a newer
 * qualifying event replaces the current toast and restarts the timer.
 */
const XpToast = ({ event }: XpToastProps) => {
  const [visibleXp, setVisibleXp] = useState<number | null>(null);

  const qualifies =
    event?.overall_status === SUBMISSION_STATUS.ACCEPTED &&
    typeof event.xp_awarded === 'number' &&
    event.xp_awarded > 0;

  useEffect(() => {
    if (!qualifies || event?.xp_awarded == null) return;

    setVisibleXp(event.xp_awarded);
    const timer = window.setTimeout(() => setVisibleXp(null), DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [qualifies, event]);

  if (visibleXp == null) return null;

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      +{visibleXp} XP
    </div>
  );
};

export default XpToast;
