import { useState } from 'react';
import { DataTable, Drawer, InlineNotice, StatusDot, type DataTableColumn } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { formatDateTime } from '../../../utils/formatters';
import { Job } from './types';
import { jobLabel, jobStatus, verifyFailureExplanation } from './status';
import styles from './Verify.module.css';

const words = (code: string) => code.replace(/_/g, ' ');

/** "Failed · case 7 wrong answer", "Timed out", "Succeeded". */
export function jobResult(job: Job): { tone: 'neutral' | 'pass' | 'warn' | 'fail'; label: string } {
  const { label } = jobStatus(job.status);
  if (job.status === 'succeeded') return { tone: 'pass', label };
  if (job.status === 'timed_out') return { tone: 'warn', label };
  if (job.status !== 'failed') return { tone: 'neutral', label };
  const failedCase = job.resultSummary?.failedCase;
  const reason = [failedCase ? `case ${failedCase.caseNumber}` : '', job.errorCode ? words(job.errorCode) : ''].filter(Boolean).join(' ');
  return { tone: 'fail', label: reason ? `${label} · ${reason}` : label };
}

const columns: DataTableColumn<Job>[] = [
  { key: 'job', header: 'Job', cell: (job) => jobLabel(job.jobType), mobile: 'primary' },
  { key: 'result', header: 'Result', cell: (job) => { const r = jobResult(job); return <StatusDot tone={r.tone} label={r.label} />; }, mobile: 'meta' },
  { key: 'revision', header: 'Revision', cell: (job) => `rev ${job.draftRevision}`, align: 'right', mobile: 'meta' },
  { key: 'when', header: 'When', cell: (job) => (job.createdAt ? formatDateTime(job.createdAt) : '—'), mobile: 'meta' },
];

function JobDetail({ job }: { job: Job }) {
  const report = job.resultSummary?.verification;
  const failed = job.status === 'failed' || job.status === 'timed_out';
  const explanation = job.jobType === 'verify_all' && failed ? verifyFailureExplanation(job) : null;
  return <div className={styles.drawerBody}>
    {job.jobType === 'sync_pdf' && <p className={styles.muted}>Profile sync — the author snapshot was refreshed from its profile and the PDF rebuilt. Published problems were republished with the new metadata in the same step.</p>}
    {failed && <div role="alert">
      <InlineNotice tone={job.status === 'timed_out' ? 'warning' : 'danger'} title={explanation ? `${explanation.title}.` : jobStatus(job.status).label}>
        {explanation ? explanation.detail : null}
        {(job.errorCode || job.errorMessage) && <p><code>{job.errorCode}</code>{job.errorMessage ? `: ${job.errorMessage}` : ''}</p>}
      </InlineNotice>
    </div>}
    {report && <>
      <section className={styles.drawerSection} aria-label="Checks">
        <h3>Checks</h3>
        <ul className={styles.checks}>{Object.entries(report.checks).map(([key, status]) => <li key={key}><b>{key}</b> {status}</li>)}</ul>
        <p className={styles.muted}>{report.caseCount} cases · {report.totalTestcaseBytes} testcase bytes · memory limit {report.memoryLimitMb} MiB. Peak memory is unavailable; this is not a proof of algorithm correctness.</p>
        {report.warnings.length > 0 && <ul>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      </section>
      <table className={styles.cases} aria-label="Cases">
        <thead><tr><th>Case</th><th className={styles.num}>Wall time (ms)</th></tr></thead>
        <tbody>{report.cases.map((c) => <tr key={c.caseId}><td>{c.caseNumber}</td><td className={styles.num}>{c.durationMs}</td></tr>)}</tbody>
      </table>
    </>}
    <section className={styles.drawerSection} aria-label="Log">
      <h3>Log</h3>
      <pre className={styles.log}>{job.log || 'No log output.'}</pre>
    </section>
    <details><summary>Structured result</summary><pre className={styles.log}>{JSON.stringify(job.resultSummary, null, 2)}</pre></details>
  </div>;
}

/** History (§7.9): the draft's jobs; a row opens its details in a right drawer. */
export default function JobHistory({ jobs, onError }: { jobs: Job[]; onError: (error: unknown) => void }) {
  const [detail, setDetail] = useState<Job | null>(null);
  const hasSyncJob = jobs.some((job) => job.jobType === 'sync_pdf');
  const open = async (job: Job) => {
    try { setDetail(await authoringService.getJob(job.id)); }
    catch (err) { onError(err); }
  };
  return <section className={styles.tab} aria-label="History">
    <h2>History</h2>
    <p className={styles.muted}>The latest 100 jobs for this draft.</p>
    {hasSyncJob && <p role="note" className={styles.muted}>Profile sync rebuilds this draft's PDF with updated author metadata and republishes it if it was published. A failed sync leaves the previous PDF live.</p>}
    <DataTable caption="Job history" columns={columns} rows={jobs} rowKey={(job) => job.id}
      onRowClick={(job) => { void open(job); }} empty="No jobs yet." />
    <Drawer open={detail !== null} title={detail ? `${jobLabel(detail.jobType)} · rev ${detail.draftRevision}` : ''} onClose={() => setDetail(null)}>
      {detail && <JobDetail job={detail} />}
    </Drawer>
  </section>;
}
