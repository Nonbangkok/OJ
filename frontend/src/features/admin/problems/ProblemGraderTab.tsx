import { useCallback, useEffect, useState } from 'react';
import { InlineError } from '../../../components/ui';
import adminService from '../../../services/adminService';
import type { ProblemFilesResponse } from '../../../types';
import ProblemFilesSection from './ProblemFilesSection';
import styles from './ProblemEditor.module.css';

interface ProblemGraderTabProps {
  problemId: string;
  /** Submissions judged with the current grader (B6 facts). */
  submissionCount: number;
  /** Rejudge is admin-only on the server. */
  canRejudge: boolean;
}

/** Grader files tab (header problems): the grader and starter file sets. */
export default function ProblemGraderTab({ problemId, submissionCount, canRejudge }: ProblemGraderTabProps) {
  const [files, setFiles] = useState<ProblemFilesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const info = await adminService.getProblemFiles(problemId);
      setFiles(info);
      setFailed(false);
      return info;
    } catch {
      setFailed(true);
      return undefined;
    }
  }, [problemId]);

  useEffect(() => {
    let cancelled = false;
    adminService.getProblemFiles(problemId)
      .then((info) => { if (!cancelled) setFiles(info); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [problemId]);

  return (
    <div className={styles.panel}>
      {failed && !files && <InlineError message="Could not load the grader files." />}
      {!failed && !files && <p className={styles.muted} aria-live="polite">Loading grader files…</p>}
      {files && (
        <ProblemFilesSection
          problemId={problemId}
          files={files.files}
          onChanged={load}
          submissionCount={submissionCount}
          canRejudge={canRejudge}
        />
      )}
    </div>
  );
}
