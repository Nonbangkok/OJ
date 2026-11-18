import { useCallback, useEffect, useState } from 'react';
import { Button, ConfirmDialog, Dialog, EmptyState, FileDrop, InlineError } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { CHUNKED_UPLOAD_CONFIG } from '../../../config/upload';
import { getErrorMessage } from '../../../utils/error';
import type { TestcaseMetadataResponse, TestcaseViewResponse } from '../../../types';
import { countZipTestcases } from './countZipTestcases';
import { uploadTestcasesZip } from './uploadTestcasesZip';
import RejudgeOnReplace, { plural, rejudgeAfterReplace } from './RejudgeOnReplace';
import editorStyles from './ProblemEditor.module.css';
import styles from './ProblemTestcasesTab.module.css';

interface ProblemTestcasesTabProps {
  problemId: string;
  /** Submissions judged against the current set (B6 facts). */
  submissionCount: number;
  /** Rejudge is admin-only on the server. */
  canRejudge: boolean;
}

const VIEW_CHARS = 4096;

/** Decimal sizes, as the mockup writes them: "120 kB", "2.4 MB". */
export const formatSize = (bytes: number): string => {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) {
    const kb = bytes / 1000;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

function CasePane({ label, side }: { label: string; side: TestcaseViewResponse['input'] }) {
  const shown = side.content.slice(0, VIEW_CHARS);
  return (
    <div className={styles.pane}>
      <h3 className={styles.paneTitle}>{label}</h3>
      <pre className={styles.pre} aria-label={label}>{shown || '(empty)'}</pre>
      {side.content.length > VIEW_CHARS && (
        <p className={editorStyles.muted}>Showing the first 4 KB of {formatSize(side.bytes)}</p>
      )}
    </div>
  );
}

export default function ProblemTestcasesTab({ problemId, submissionCount, canRejudge }: ProblemTestcasesTabProps) {
  const [cases, setCases] = useState<TestcaseMetadataResponse[] | null>(null);
  const [listError, setListError] = useState('');
  const [viewing, setViewing] = useState<number | null>(null);
  const [view, setView] = useState<{ number: number; data: TestcaseViewResponse | null; error: string } | null>(null);
  const [pending, setPending] = useState<{ file: File; count: number | null } | null>(null);
  const [rejudge, setRejudge] = useState(true);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const reload = useCallback(async () => {
    const data = await adminService.getProblemTestcases(problemId);
    setCases(data.testcases);
    return data.testcases;
  }, [problemId]);

  useEffect(() => {
    let cancelled = false;
    adminService.getProblemTestcases(problemId)
      .then((data) => { if (!cancelled) setCases(data.testcases); })
      .catch((err) => { if (!cancelled) setListError(getErrorMessage(err, 'Could not load the testcases.')); });
    return () => { cancelled = true; };
  }, [problemId]);

  const openCase = async (number: number) => {
    setViewing(number);
    setView({ number, data: null, error: '' });
    try {
      const data = await adminService.getProblemTestcase(problemId, number);
      setView({ number, data, error: '' });
    } catch (err) {
      setView({ number, data: null, error: getErrorMessage(err, 'Could not load this case.') });
    }
  };

  const pick = async ([file]: File[]) => {
    if (!file) return;
    setError('');
    setDone('');
    const count = await countZipTestcases(file);
    if (count === 0) {
      setError(`No N.in / N.out pairs found in ${file.name}.`);
      return;
    }
    setRejudge(true);
    setPending({ file, count });
  };

  const total = cases?.length ?? 0;
  const bytes = (cases ?? []).reduce((sum, c) => sum + c.input_bytes + c.output_bytes, 0);
  const willRejudge = canRejudge && submissionCount > 0 && rejudge;

  const replace = async () => {
    if (!pending) return;
    const { file } = pending;
    const rejudgeAfter = willRejudge;
    setPending(null);
    setError('');
    setProgress('Uploading…');
    let next: TestcaseMetadataResponse[];
    try {
      await uploadTestcasesZip(problemId, file, setProgress);
      next = await reload();
    } catch (err) {
      setError(getErrorMessage(err, 'Replacing the testcases failed.'));
      setProgress('');
      return;
    }
    // The replace has landed; a rejudge failure is reported on its own, not as a failed replace.
    let rejudged = false;
    if (rejudgeAfter) {
      setProgress('Starting the rejudge…');
      const rejudgeError = await rejudgeAfterReplace(problemId);
      if (rejudgeError) setError(rejudgeError);
      else rejudged = true;
    }
    setDone(`Replaced with ${plural(next.length, 'testcase')}.${rejudged ? ` Rejudging ${plural(submissionCount, 'submission')}.` : ''}`);
    setProgress('');
  };

  const confirmTitle = (() => {
    const count = pending?.count ?? null;
    if (total === 0) return count === null ? 'Add these testcases?' : `Add ${plural(count, 'testcase')}?`;
    return count === null ? `Replace all ${plural(total, 'testcase')}?` : `Replace ${plural(total, 'testcase')} with ${count}?`;
  })();

  return (
    <div className={editorStyles.panel}>
      <section className={editorStyles.section} aria-labelledby="problem-testcases-title">
        <h2 id="problem-testcases-title" className={editorStyles.sectionTitle}>Testcases</h2>
        {listError && <InlineError message={listError} />}
        {cases === null && !listError && <p className={editorStyles.muted} aria-live="polite">Loading testcases…</p>}
        {cases !== null && (
          <>
            <p className={styles.summary}>{`${plural(total, 'testcase')} · ${formatSize(bytes)}`}</p>
            {total === 0 ? (
              <EmptyState title="No testcases yet. Submissions to this problem can’t be judged." />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.num}>#</th>
                      <th scope="col" className={styles.num}>Input</th>
                      <th scope="col" className={styles.num}>Output</th>
                      <th scope="col" className={styles.num}>Total</th>
                      <th scope="col"><span className={styles.srOnly}>View</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((c) => (
                      <tr key={c.case_number}>
                        <td className={styles.num}>{c.case_number}</td>
                        <td className={styles.num}>{formatSize(c.input_bytes)}</td>
                        <td className={styles.num}>{formatSize(c.output_bytes)}</td>
                        <td className={styles.num}>{formatSize(c.input_bytes + c.output_bytes)}</td>
                        <td className={styles.action}>
                          <Button size="compact" variant="secondary" aria-label={`View case ${c.case_number}`} onClick={() => { void openCase(c.case_number); }}>
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className={editorStyles.section} aria-label="Replace testcases">
        <FileDrop
          label="Replace all testcases — drop a ZIP of N.in / N.out pairs"
          hint="Flat ZIP up to 2 GiB. input1.txt / output1.txt and .sol outputs work too."
          accept={['.zip']}
          maxBytes={CHUNKED_UPLOAD_CONFIG.maxFileBytes}
          disabled={progress !== ''}
          onFiles={(files) => { void pick(files); }}
        />
        {progress && <p className={editorStyles.muted} aria-live="polite">{progress}</p>}
        {done && <p className={editorStyles.saved} role="status">{done}</p>}
        {error && <InlineError message={error} />}
      </section>

      <ConfirmDialog
        open={pending !== null}
        tier="destructive"
        title={confirmTitle}
        body={(
          <RejudgeOnReplace
            lead={<>Every current case is deleted and replaced by the ones in {pending?.file.name}.</>}
            submissionCount={submissionCount}
            judgedWith="against the current set"
            canRejudge={canRejudge}
            rejudge={rejudge}
            onToggleRejudge={() => setRejudge((v) => !v)}
          />
        )}
        confirmLabel={willRejudge ? 'Replace and rejudge' : 'Replace testcases'}
        onConfirm={() => { void replace(); }}
        onCancel={() => setPending(null)}
      />

      <Dialog
        open={viewing !== null}
        wide
        title={`Case ${viewing ?? ''}`}
        onClose={() => { setViewing(null); setView(null); }}
        footer={<Button variant="secondary" onClick={() => { setViewing(null); setView(null); }}>Close</Button>}
      >
        {view && !view.data && !view.error && <p className={editorStyles.muted}>Loading case…</p>}
        {view?.error && <InlineError message={view.error} />}
        {view?.data && (
          <div className={styles.panes}>
            <CasePane label={`Input of case ${view.number}`} side={view.data.input} />
            <CasePane label={`Output of case ${view.number}`} side={view.data.output} />
          </div>
        )}
      </Dialog>
    </div>
  );
}
