import { useEffect, useState } from 'react';
import { Button, Dialog, StatusBadge } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { formatDateTime } from '../../../utils/formatters';
import { Job, ProfileSyncItem, ProfileSyncRun } from './types';
import { jobLabel, jobStatus } from './status';
import styles from './Authoring.module.css';

const SYNC_ITEM_TONES: Record<ProfileSyncItem['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  syncing: { label: 'Syncing', tone: 'info' },
  synced: { label: 'Synced', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  deferred: { label: 'Deferred', tone: 'warning' },
};

/** Recent profile-edit cascades across all drafts, from the profile-sync APIs. */
function ProfileSyncRuns({ onError }: { onError: (error: unknown) => void }) {
  const [runs, setRuns] = useState<ProfileSyncRun[] | null>(null);
  const [detail, setDetail] = useState<ProfileSyncRun | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    authoringService.listProfileSyncs()
      .then(list => { if (!cancelled) setRuns(list); })
      .catch(onError);
    return () => { cancelled = true; };
  }, [onError]);
  return <section className={styles.panel} aria-label="Profile sync runs">
    <div className={styles.panelHead}>
      <h3>Profile sync runs</h3>
      <p>Author profile edits cascade to every linked draft: metadata is refreshed, PDFs rebuild, and published problems republish.</p>
    </div>
    <div className={styles.panelBody}>
      {runs && runs.length > 0 && <div className={styles.scroll}><table><thead><tr><th>Profile</th><th>Status</th><th>Progress</th><th>Created</th><th>Detail</th></tr></thead>
        <tbody>{runs.map(run => <tr key={run.id}>
          <td>{run.profileAkaName ?? run.profileId}</td>
          <td><StatusBadge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'info'}>{run.status}</StatusBadge></td>
          <td>{run.progress.synced}/{run.progress.total} synced{run.progress.failed > 0 && ` (${run.progress.failed} not synced)`}</td>
          <td>{formatDateTime(run.createdAt)}</td>
          <td><Button size="compact" variant="secondary" disabled={loading} onClick={async () => {
            setLoading(true); try { setDetail(await authoringService.getProfileSync(run.id)); }
            catch (err) { onError(err); } finally { setLoading(false); }
          }}>Inspect run</Button></td>
        </tr>)}</tbody></table></div>}
      {runs && !runs.length && <p>No profile sync runs yet.</p>}
      {!runs && <p role="status">Loading sync runs…</p>}
      {detail && <Dialog open title={`Profile sync: ${detail.status} (${detail.progress.synced}/${detail.progress.total} synced)`}
        onClose={() => setDetail(null)}
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}>
        <div className={styles.scroll}><table><thead><tr><th>Draft</th><th>Published</th><th>Status</th><th>Attempts</th><th>Error</th></tr></thead>
          <tbody>{(detail.items ?? []).map(item => { const status = SYNC_ITEM_TONES[item.status]; return <tr key={item.draftId}>
            <td>{item.problemId} — {item.title}</td>
            <td>{item.published ? 'Yes' : 'No'}</td>
            <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
            <td>{item.attempts}</td>
            <td>{item.errorMessage ?? '—'}</td>
          </tr>; })}</tbody></table></div>
        {detail.resultSummary?.warnings?.map((warning, i) => <p key={i} role="note">{warning}</p>)}
      </Dialog>}
    </div>
  </section>;
}

export default function JobHistory({ jobs, onError }: { jobs: Job[]; onError: (error: unknown) => void }) {
  const [detail, setDetail] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const report = detail?.resultSummary?.verification;
  const hasSyncJob = jobs.some(job => job.jobType === 'sync_pdf');
  return <section>
    <h2>Build history &amp; logs</h2>
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Build jobs</h3>
        <p>Latest 100 jobs. Reloading this page preserves job history on the server.</p>
      </div>
      <div className={styles.panelBody}>
        {hasSyncJob && <p role="note" className={styles.caution}>Profile sync rebuilds this draft's PDF with updated author metadata and republishes it if it was published. A failed sync leaves the previous PDF live.</p>}
        <div className={styles.scroll}><table><thead><tr><th>Action</th><th>Status</th><th>Created</th><th>Report</th></tr></thead>
          <tbody>{jobs.map(job => { const status = jobStatus(job.status); return <tr key={job.id}><td>{jobLabel(job.jobType)}</td>
            <td><StatusBadge tone={status.tone} soft>{status.label}</StatusBadge></td>
            <td>{job.createdAt ? formatDateTime(job.createdAt) : '—'}</td><td><Button size="compact" variant="secondary" disabled={loading} onClick={async () => {
              setLoading(true); try { setDetail(await authoringService.getJob(job.id)); }
              catch (err) { onError(err); } finally { setLoading(false); }
            }}>Inspect {jobLabel(job.jobType)}</Button></td></tr>; })}</tbody></table></div>
        {!jobs.length && <p>No builds yet.</p>}
      </div>
    </section>
    <ProfileSyncRuns onError={onError} />
    {detail && <Dialog open title={`${jobLabel(detail.jobType)}: ${detail.status}`}
      onClose={() => setDetail(null)}
      footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}>
      {detail.jobType === 'sync_pdf' && <p>Profile sync — the author snapshot was refreshed from its profile and the PDF rebuilt. Published problems were republished with the new metadata in the same step.</p>}
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
