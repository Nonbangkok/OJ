import type { RejudgeFeedback } from '../../../hooks/admin/useRejudge';
import styles from './Management.module.css';

interface RejudgeFeedbackBoxProps {
  feedback: RejudgeFeedback;
  onDismiss: () => void;
}

/** Success/error banner for a triggered rejudge; mirrors the batch-upload
 *  feedback box styling so both panels read as one visual language. */
const RejudgeFeedbackBox = ({ feedback, onDismiss }: RejudgeFeedbackBoxProps) => {
  if (!feedback.visible) {
    return null;
  }

  return (
    <div className={`${styles.feedbackBox} ${styles[feedback.type]}`} role="status">
      <div className={styles.feedbackContent}>
        <p>{feedback.message}</p>
      </div>
      <button
        type="button"
        className={styles.closeButton}
        aria-label="Dismiss rejudge message"
        onClick={onDismiss}
      >
        &times;
      </button>
    </div>
  );
};

export default RejudgeFeedbackBox;
