import type { ReactNode } from 'react';
import {
  DataTable,
  ProgressBar,
  StatusMark,
  TestcaseStrip,
  VerdictText,
  passedCount,
  verdictTone,
  type DataTableColumn,
} from '../../components/ui';
import { formatTimeAgo } from '../../utils/formatters';
import type { SubmissionDetail, TestCaseResult } from '../../types';
import styles from './SubmissionResult.module.css';

const PENDING = new Set(['Pending', 'Compiling', 'Running']);
const COMPILATION_ERROR = 'Compilation Error';
const SKIPPED = 'Skipped';
const ACCEPTED = 'Accepted';

interface CaseRow extends TestCaseResult {
  index: number;
}

const formatMb = (kb: number) => `${(kb / 1024).toFixed(1)} MB`;

/**
 * The full verdict for one submission: big verdict and score, the testcase
 * strip, where judging stopped, and a per-case table with time and memory
 * against the problem's limits. Shared by the inline result under the
 * submit form and the submission detail page.
 */
export default function SubmissionResult({
  submission,
  limits,
  actions,
}: {
  submission: SubmissionDetail;
  limits: { timeMs: number; memoryMb: number };
  actions?: ReactNode;
}) {
  const status = submission.overall_status;
  const results = Array.isArray(submission.results) ? submission.results : [];
  const meta = (
    <p className={styles.meta}>
      <span className={styles.mono}>{`#${submission.id}`}</span>
      <span>{formatTimeAgo(submission.submitted_at)}</span>
    </p>
  );

  if (PENDING.has(status)) {
    return (
      <section className={styles.result} aria-label="Result">
        <div className={styles.head}>
          <div role="status" aria-live="polite" className={styles.verdictLine}>
            <StatusMark tone="pending" size={20} />
            <span className={styles.verdictBig} data-tone="pending">Judging…</span>
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
        {meta}
        {results.length > 0 && <TestcaseStrip results={results} size="lg" />}
      </section>
    );
  }

  const tone = verdictTone(status);
  const header = (
    <div className={styles.head}>
      <div className={styles.verdictLine}>
        <StatusMark tone={tone} size={22} />
        <span className={styles.verdictBig} data-tone={tone}>{status.toUpperCase()}</span>
        {results.length > 0 && (
          <span className={styles.score}>{`${passedCount(results)}/${results.length} · ${submission.score} pts`}</span>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );

  if (status === COMPILATION_ERROR) {
    const log = typeof submission.results === 'string' ? submission.results : '';
    return (
      <section className={styles.result} aria-label="Result">
        {header}
        {meta}
        {log && <pre className={styles.log}>{log}</pre>}
      </section>
    );
  }

  const rows: CaseRow[] = results.map((r, i) => ({ ...r, index: i + 1 }));
  const firstFailing = rows.find((r) => r.status !== ACCEPTED && r.status !== SKIPPED);
  const skipped = rows.filter((r) => r.status === SKIPPED);
  const timeLimit = limits.timeMs;
  const memoryLimitKb = limits.memoryMb * 1024;

  const columns: DataTableColumn<CaseRow>[] = [
    { key: 'index', header: '#', align: 'right', width: '48px', cell: (r) => String(r.index), mobile: 'meta' },
    { key: 'verdict', header: 'Verdict', cell: (r) => <VerdictText status={r.status} />, mobile: 'primary' },
    {
      key: 'time',
      header: `Time / ${timeLimit} ms`,
      mobile: 'meta',
      cell: (r) => (r.status === SKIPPED || r.timeMs === undefined ? '—' : (
        <span className={styles.measure}>
          <span className={styles.mono}>{`${r.timeMs} ms`}</span>
          <ProgressBar
            value={r.timeMs}
            max={timeLimit}
            label={`Case ${r.index} time: ${r.timeMs} ms of ${timeLimit} ms`}
            tone="neutral"
          />
        </span>
      )),
    },
    {
      key: 'memory',
      header: `Memory / ${limits.memoryMb} MB`,
      mobile: 'meta',
      cell: (r) => (r.status === SKIPPED || r.memoryKb === undefined ? '—' : (
        <span className={styles.measure}>
          <span className={styles.mono}>{formatMb(r.memoryKb)}</span>
          <ProgressBar
            value={r.memoryKb}
            max={memoryLimitKb}
            label={`Case ${r.index} memory: ${formatMb(r.memoryKb)} of ${limits.memoryMb} MB`}
          />
        </span>
      )),
    },
  ];

  return (
    <section className={styles.result} aria-label="Result">
      {header}
      {meta}
      {results.length > 0 && <TestcaseStrip results={results} size="lg" />}
      {firstFailing && skipped.length > 0 && (
        <p className={styles.note}>
          {`Stopped at case ${firstFailing.index}. Cases ${skipped[0].index}–${skipped[skipped.length - 1].index} were not run.`}
        </p>
      )}
      {rows.length > 0 && (
        <DataTable<CaseRow>
          caption="Test cases"
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.index)}
          highlightKey={firstFailing ? String(firstFailing.index) : undefined}
        />
      )}
    </section>
  );
}
