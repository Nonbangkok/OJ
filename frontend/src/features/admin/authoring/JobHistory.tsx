import { useState } from 'react';
import { Button, Dialog, StatusBadge } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { formatDateTime } from '../../../utils/formatters';
import { Job } from './types';
import { jobLabel, jobStatus } from './status';
import styles from './Authoring.module.css';

export default function JobHistory({ jobs, onError }: { jobs: Job[]; onError: (error: unknown) => void }) {
  const [detail, setDetail] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const report = detail?.resultSummary?.verification;
  return <section><h2>Build history & logs</h2><p>Latest 100 jobs. Reloading this page preserves job history on the server.</p>
    <div className={styles.scroll}><table><thead><tr><th>Action</th><th>Revision</th><th>Status</th><th>Created</th><th>Report</th></tr></thead>
      <tbody>{jobs.map(job => { const status = jobStatus(job.status); return <tr key={job.id}><td>{jobLabel(job.jobType)}</td>
        <td>{job.draftRevision}</td><td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
        <td>{job.createdAt ? formatDateTime(job.createdAt) : '—'}</td><td><Button size="compact" variant="secondary" disabled={loading} onClick={async () => {
          setLoading(true); try { setDetail(await authoringService.getJob(job.id)); }
          catch (err) { onError(err); } finally { setLoading(false); }
        }}>Inspect {jobLabel(job.jobType)} r{job.draftRevision}</Button></td></tr>; })}</tbody></table></div>
    {!jobs.length && <p>No builds yet.</p>}
    {detail && <Dialog open title={`${jobLabel(detail.jobType)}: ${detail.status} (revision ${detail.draftRevision})`}
      onClose={() => setDetail(null)}
      footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}>
      {(detail.errorCode || detail.errorMessage) && <p role="alert">{detail.errorCode}: {detail.errorMessage}</p>}
      {report && <>
        <ul>{Object.entries(report.checks).map(([key, status]) => <li key={key}>{key}: {status}</li>)}</ul>
        <p>{report.caseCount} cases / {report.totalTestcaseBytes} testcase bytes. Memory limit: {report.memoryLimitMb} MiB.</p>
        <p>Peak memory is unavailable; execution is bounded by runner limits. This is not a proof of algorithm correctness.</p>
        <ul>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
        <div className={styles.scroll}><table><thead><tr><th>Case</th><th>Wall time (ms)</th></tr></thead><tbody>
          {report.cases.map(c => <tr key={c.caseId}><td>{c.caseNumber}</td><td>{c.durationMs}</td></tr>)}
        </tbody></table></div>
      </>}
      <details><summary>Structured result</summary><pre>{JSON.stringify(detail.resultSummary, null, 2)}</pre></details>
      <h4>Diagnostics</h4><pre>{detail.log || 'No log output.'}</pre>
    </Dialog>}
  </section>;
}
