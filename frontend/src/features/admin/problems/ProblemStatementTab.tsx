import { useState } from 'react';
import { FileDrop, InlineError } from '../../../components/ui';
import adminService from '../../../services/adminService';
import problemService from '../../../services/problemService';
import { getErrorMessage } from '../../../utils/error';
import styles from './ProblemEditor.module.css';

interface ProblemStatementTabProps {
  problemId: string;
  hasPdf: boolean;
  onReplaced: () => void;
}

/** Statement PDF: open the current one, drop a new one to replace it (uploads straight away). */
export default function ProblemStatementTab({ problemId, hasPdf, onReplaced }: ProblemStatementTabProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replaced, setReplaced] = useState(false);

  const upload = async ([file]: File[]) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setReplaced(false);
    try {
      const formData = new FormData();
      formData.append('problemPdf', file);
      await adminService.uploadFiles(problemId, formData);
      setReplaced(true);
      onReplaced();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to upload the statement PDF.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby="problem-statement-title">
        <h2 id="problem-statement-title" className={styles.sectionTitle}>Statement</h2>
        <p className={styles.muted}>
          {hasPdf ? (
            <a href={problemService.getPdfUrl(problemId)} target="_blank" rel="noreferrer">Open current PDF</a>
          ) : 'No statement PDF yet. Students see a placeholder until you add one.'}
        </p>
        <FileDrop
          label={hasPdf ? 'Replace statement PDF' : 'Add statement PDF'}
          hint="PDF only. Replaces the current statement for everyone straight away."
          accept={['.pdf']}
          disabled={busy}
          onFiles={upload}
        />
        {busy && <p className={styles.muted} aria-live="polite">Uploading…</p>}
        {replaced && <p className={styles.saved} role="status">Statement replaced.</p>}
        {error && <InlineError message={error} />}
      </section>
    </div>
  );
}
