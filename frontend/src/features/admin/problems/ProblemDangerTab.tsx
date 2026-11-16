import { useState } from 'react';
import { Button, ConfirmDialog, InlineError, SettingsRow } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import styles from './ProblemEditor.module.css';

interface ProblemDangerTabProps {
  problemId: string;
  title: string;
  submissionCount: number;
  onDeleted: () => void;
}


export default function ProblemDangerTab({ problemId, title, submissionCount, onDeleted }: ProblemDangerTabProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await adminService.deleteProblem(problemId);
      setConfirming(false);
      onDeleted();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete the problem.'));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby="problem-danger-title">
        <h2 id="problem-danger-title" className={styles.sectionTitle}>Danger zone</h2>
        <SettingsRow
          danger
          label="Delete problem"
          help="Removes the statement, testcases and every submission. XP already earned stays."
          control={<Button variant="destructive" onClick={() => setConfirming(true)}>Delete problem</Button>}
        />
        {error && <InlineError message={error} />}
      </section>
      <ConfirmDialog
        open={confirming}
        tier="typed"
        confirmText={problemId}
        title={`Delete ${title}?`}
        body={`${submissionCount === 1 ? '1 submission goes' : `${submissionCount} submissions go`} with it, along with the testcases and the statement. This can't be undone.`}
        confirmLabel="Delete problem"
        busy={busy}
        onConfirm={() => { void remove(); }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
