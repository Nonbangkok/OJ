import type { ReactNode } from 'react';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import styles from './RejudgeOnReplace.module.css';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface RejudgeOnReplaceProps {
  /** What the replace does, in one sentence. */
  lead: ReactNode;
  /** Submissions judged with what is being replaced (B6 facts). */
  submissionCount: number;
  /** How they were judged, finishing "N earlier submissions were judged …". */
  judgedWith: string;
  /** Rejudge is admin-only on the server. */
  canRejudge: boolean;
  rejudge: boolean;
  onToggleRejudge: () => void;
}

/**
 * Body of a replace confirm that verdicts depend on (testcases, grader
 * files): what goes, how many submissions were judged with it, and, for an
 * admin, the "Rejudge after replacing" switch.
 */
export default function RejudgeOnReplace({ lead, submissionCount, judgedWith, canRejudge, rejudge, onToggleRejudge }: RejudgeOnReplaceProps) {
  return (
    <div className={styles.confirmBody}>
      <p>{lead}</p>
      {submissionCount > 0 && (
        <p>{`${plural(submissionCount, 'earlier submission')} ${submissionCount === 1 ? 'was' : 'were'} judged ${judgedWith}.`}{!canRejudge && ' An admin can rejudge them afterwards.'}</p>
      )}
      {submissionCount > 0 && canRejudge && (
        <label className={styles.switchRow}>
          <span className={styles.toggleSwitch}>
            <input type="checkbox" role="switch" aria-label="Rejudge after replacing" checked={rejudge} onChange={onToggleRejudge} />
            <span className={styles.toggleTrack} aria-hidden="true" />
          </span>
          <span>Rejudge after replacing</span>
        </label>
      )}
    </div>
  );
}

/**
 * Starts the problem's rejudge once a replace has landed. Resolves to the
 * message to show when it did not start (the replace itself still stands),
 * or null when it did.
 */
export const rejudgeAfterReplace = async (problemId: string): Promise<string | null> => {
  try {
    await adminService.rejudgeProblem(problemId);
    return null;
  } catch (err) {
    return `The rejudge didn't start: ${getErrorMessage(err, 'unknown error')}. Run it from the problem's row menu.`;
  }
};
