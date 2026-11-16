import { useEffect, useState, useEffectEvent } from 'react';
import { Button, Dialog, InlineError, StatusBadge, StatusDot } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { formatDateTime } from '../../../utils/formatters';
import type { ProfileSyncItem, ProfileSyncRun } from './types';
import styles from './AuthorProfiles.module.css';

const SYNC_ITEM_TONES: Record<ProfileSyncItem['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  syncing: { label: 'Syncing', tone: 'info' },
  synced: { label: 'Synced', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  deferred: { label: 'Deferred', tone: 'warning' },
};
const RUN_DOT = { succeeded: ['pass', 'Done'], failed: ['fail', 'Failed'], running: ['warn', 'Running'], queued: ['neutral', 'Queued'] } as const;

/** Recent profile-edit cascades across all drafts (moved here from a draft's History, §7.9). */
export default function ProfileSyncRuns({ onError }: { onError: (error: unknown) => void }) {
  const [runs, setRuns] = useState<ProfileSyncRun[] | null>(null);
  const [detail, setDetail] = useState<ProfileSyncRun | null>(null);
  const [loading, setLoading] = useState(false);
  // Load once: the parent passes a fresh onError on every render (each keystroke in the drawer).
  const reportError = useEffectEvent(onError);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    authoringService.listProfileSyncs()
      .then((list) => { if (!cancelled) { setRuns(list); setLoadFailed(false); } })
      .catch((err: unknown) => { if (!cancelled) { setLoadFailed(true); reportError(err); } });
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <section className={styles.syncs} aria-labelledby="profile-syncs-title">
      <h2 id="profile-syncs-title" className={styles.sectionTitle}>Recent profile syncs</h2>
      <p className={styles.hint}>Editing an author's details refreshes every linked draft: metadata updates, PDFs rebuild and published problems republish.</p>
      {runs && runs.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Profile</th><th>Status</th><th>Progress</th><th>Started</th><th><span className={styles.srOnly}>Detail</span></th></tr></thead>
            <tbody>
              {runs.map((run) => {
                const [tone, label] = RUN_DOT[run.status] ?? ['neutral', run.status];
                return (
                  <tr key={run.id}>
                    <td>{run.profileAkaName ?? run.profileId}</td>
                    <td><StatusDot tone={tone} label={label} /></td>
                    <td className={styles.mono}>{`${run.progress.synced}/${run.progress.total} synced`}{run.progress.failed > 0 && ` (${run.progress.failed} not synced)`}</td>
                    <td className={styles.hint}>{formatDateTime(run.createdAt)}</td>
                    <td>
                      <Button size="compact" variant="secondary" disabled={loading} onClick={async () => {
                        setLoading(true);
                        try { setDetail(await authoringService.getProfileSync(run.id)); } catch (err) { onError(err); } finally { setLoading(false); }
                      }}>Inspect run</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {runs && !runs.length && <p className={styles.hint}>No profile sync runs yet.</p>}
      {!runs && loadFailed && <InlineError message="Could not load profile syncs." onRetry={() => { setLoadFailed(false); setAttempt((n) => n + 1); }} />}
      {!runs && !loadFailed && <p role="status" className={styles.hint}>Loading sync runs…</p>}
      {detail && (
        <Dialog open title={`Profile sync: ${detail.status} (${detail.progress.synced}/${detail.progress.total} synced)`}
          onClose={() => setDetail(null)}
          footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Draft</th><th>Published</th><th>Status</th><th>Attempts</th><th>Error</th></tr></thead>
              <tbody>{(detail.items ?? []).map((item) => {
                const status = SYNC_ITEM_TONES[item.status];
                return (
                  <tr key={item.draftId}>
                    <td>{item.problemId} — {item.title}</td>
                    <td>{item.published ? 'Yes' : 'No'}</td>
                    <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
                    <td>{item.attempts}</td>
                    <td>{item.errorMessage ?? '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {detail.resultSummary?.warnings?.map((warning, i) => <p key={i} role="note">{warning}</p>)}
        </Dialog>
      )}
    </section>
  );
}
