import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog } from '../../../components/ui';
import adminService from '../../../services/adminService';
import type { TestcaseViewResponse } from '../../../types';
import { UI_TIMEOUTS } from '../../../config/constants';
import styles from './TestcasesDialog.module.css';

interface TestcasesDialogProps {
  /** Problem whose testcases are shown; `null` keeps the dialog closed. */
  problem: { id: string } | null;
  onClose: () => void;
}

interface CaseState {
  content: TestcaseViewResponse | null;
  loading: boolean;
  error: string | null;
}

/** "1.5 KB" style byte sizes for the metadata table. */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/** Copy with the same clipboard fallback as useSubmissionModal. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
};

function ContentPane({ label, content, truncated, bytes }: {
  label: string;
  content: string;
  truncated: boolean;
  bytes: number;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyText(content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), UI_TIMEOUTS.COPY_CLIPBOARD);
    }
  };

  return (
    <div className={styles.pane}>
      <div className={styles.paneHeader}>
        <h5>{label}</h5>
        <div className={styles.paneHeaderMeta}>
          {truncated && (
            <span className={styles.paneTruncated}>
              Truncated — showing 1 MB of {formatBytes(bytes)}
            </span>
          )}
          <Button
            size="compact"
            variant="secondary"
            onClick={handleCopy}
            aria-label={`Copy ${label.toLowerCase()} of this case`}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <pre aria-label={`${label} of this testcase`}>{content || '(empty)'}</pre>
    </div>
  );
}

/** View every testcase of one problem: metadata list with lazy per-case
 *  expansion (content is fetched only when a row is opened — a problem can
 *  carry hundreds of multi-megabyte cases). */
export default function TestcasesDialog({ problem, onClose }: TestcasesDialogProps) {
  const [cases, setCases] = useState<Array<{ case_number: number; input_bytes: number; output_bytes: number }>>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  // Case content cache keyed by case number so re-expanding is instant.
  const [fetched, setFetched] = useState<Record<number, CaseState>>({});

  const problemId = problem?.id ?? null;

  useEffect(() => {
    if (!problemId) return;
    let cancelled = false;
    setListLoading(true);
    setListError('');
    adminService.getProblemTestcases(problemId)
      .then((data) => {
        if (cancelled) return;
        setCases(data.testcases);
        setTotal(data.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setListError(err?.response?.data?.message ?? 'Could not load testcases');
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  // Reset expansion state when the dialog re-opens for a different problem.
  useEffect(() => {
    setExpanded(null);
    setFetched({});
  }, [problemId]);

  const toggleCase = useCallback(async (caseNumber: number) => {
    if (expanded === caseNumber) {
      setExpanded(null);
      return;
    }
    setExpanded(caseNumber);
    if (fetched[caseNumber]) return;

    if (!problemId) return;
    setFetched((previous) => ({ ...previous, [caseNumber]: { content: null, loading: true, error: null } }));
    try {
      const content = await adminService.getProblemTestcase(problemId, caseNumber);
      setFetched((previous) => ({ ...previous, [caseNumber]: { content, loading: false, error: null } }));
    } catch (err) {
      setFetched((previous) => ({
        ...previous,
        [caseNumber]: { content: null, loading: false, error: err?.response?.data?.message ?? 'Could not load this case' },
      }));
    }
  }, [expanded, fetched, problemId]);

  if (!problem) return null;

  return (
    <Dialog
      open
      wide
      title={`Testcases: ${problem.id}`}
      description={listLoading ? 'Loading…' : `${total} testcase${total === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {listError && <p role="alert">{listError}</p>}

      {listLoading ? (
        <p className={styles.hint}>Loading testcases…</p>
      ) : total === 0 ? (
        // Also the visible indicator for DB-06 (visible problems with no
        // testcases): a zero here says "this problem is unjudgeable".
        <p className={styles.empty}>
          This problem has no testcases. Submissions against it cannot be judged.
        </p>
      ) : (
        <ul className={styles.caseList}>
          {cases.map((meta) => {
            const isOpen = expanded === meta.case_number;
            const state = fetched[meta.case_number];
            return (
              <li key={meta.case_number} className={styles.caseItem}>
                <button
                  type="button"
                  className={`${styles.caseToggle}${isOpen ? ` ${styles.caseToggleOpen}` : ''}`}
                  aria-expanded={isOpen}
                  onClick={() => toggleCase(meta.case_number)}
                >
                  <span className={styles.caseNumber}>#{meta.case_number}</span>
                  <span className={styles.caseSize}>in {formatBytes(meta.input_bytes)}</span>
                  <span className={styles.caseSize}>out {formatBytes(meta.output_bytes)}</span>
                  <span className={styles.chevron} aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className={styles.caseBody}>
                    {state?.loading && <p className={styles.hint}>Loading case…</p>}
                    {state?.error && <p role="alert">{state.error}</p>}
                    {state?.content && (
                      <div className={styles.paneColumns}>
                        <ContentPane
                          label="Input"
                          content={state.content.input.content}
                          truncated={state.content.input.truncated}
                          bytes={state.content.input.bytes}
                        />
                        <ContentPane
                          label="Output"
                          content={state.content.output.content}
                          truncated={state.content.output.truncated}
                          bytes={state.content.output.bytes}
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
