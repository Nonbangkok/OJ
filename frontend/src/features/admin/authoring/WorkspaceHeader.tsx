import { ActionMenu, Button, PageHeader, StatusDot } from '../../../components/ui';
import { jobLabel, jobStatus } from './status';
import type { Draft, Job } from './types';
import styles from './Workspace.module.css';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
const STATUS_DOT = {
  draft: ['neutral', 'Draft'], generated: ['warn', 'Generated'], ready: ['pass', 'Ready'], published: ['pass', 'Published'],
} as const;

export function saveStateText(draft: Draft, saveState: SaveState, conflict: boolean): string {
  if (draft.status === 'published') return 'Published · read-only';
  if (conflict) return 'Server state changed';
  if (saveState === 'saving') return 'Saving…';
  if (saveState === 'dirty') return 'Unsaved';
  if (saveState === 'error') return 'Save failed — will retry after you edit again';
  return `Saved · rev ${draft.revision}`;
}

/**
 * Workspace header (§7.9): breadcrumb, title + status, `<problemId> · <save state>`,
 * one contextual primary (Verify / Publish; none while a job runs, none on the
 * Verify & publish tab), the running-job pill and the draft's ⋯ menu.
 */
export default function WorkspaceHeader({
  draft, saveState, conflict, activeJob, canPublish, actionsDisabled, onVerifyTab, onVerify, onPublish, onStartRevision, onDelete,
}: {
  draft: Draft;
  saveState: SaveState;
  conflict: boolean;
  activeJob: Job | undefined;
  canPublish: boolean;
  actionsDisabled: boolean;
  onVerifyTab: boolean;
  onVerify: () => void;
  onPublish: () => void;
  onStartRevision: () => void;
  onDelete: () => void;
}) {
  const [tone, label] = draft.status === 'published' ? ['pass', `Published · rev ${draft.revision}`] as const : STATUS_DOT[draft.status];
  const published = draft.status === 'published';
  const save = saveStateText(draft, saveState, conflict);

  let primary = null;
  if (activeJob) {
    primary = (
      <span className={styles.pill} role="status">
        <span className={styles.spin} aria-hidden="true" />
        {`${jobLabel(activeJob.jobType)} · ${jobStatus(activeJob.status).label.toLowerCase()}`}
      </span>
    );
  } else if (!published && !onVerifyTab) {
    if (canPublish) primary = <Button onClick={onPublish}>Publish</Button>;
    else if (draft.verifiedRevision !== draft.revision) primary = <Button disabled={actionsDisabled} onClick={onVerify}>Verify</Button>;
  }

  return (
    <PageHeader
      breadcrumb={[{ label: 'Manage' }, { label: 'Authoring', to: '/admin/authoring' }, { label: draft.problemId }]}
      title={<>{draft.title} <span className={styles.titleStatus}><StatusDot tone={tone} label={label} /></span></>}
      meta={(
        <>
          <span className={styles.mono}>{draft.problemId}</span>
          {' · '}
          <span className={saveState === 'dirty' || conflict ? `${styles.mono} ${styles.unsaved}` : styles.mono} aria-live="polite">{save}</span>
        </>
      )}
      actions={(
        <>
          {primary}
          <ActionMenu
            label="More draft actions"
            items={[
              ...(published ? [{ key: 'revision', label: 'Start new revision', onClick: onStartRevision }] : []),
              { key: 'delete', label: 'Delete draft', variant: 'danger' as const, onClick: onDelete },
            ]}
          />
        </>
      )}
    />
  );
}
