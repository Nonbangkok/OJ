import { Button, Dialog } from '../../../components/ui';

/** Pending cascade impact from the server's confirmation gate. */
export interface PendingSync {
  affectedDrafts: number;
  affectedPublishedProblems: number;
}

interface ProfileSyncGateDialogProps {
  pendingSync: PendingSync;
  saving: boolean;
  onConfirm: () => void;
  onKeepEditing: () => void;
}

/**
 * Confirmation dialog shown before an author-profile edit cascades into
 * linked drafts / published problems (profile metadata + embedded PDFs).
 */
export default function ProfileSyncGateDialog({
  pendingSync,
  saving,
  onConfirm,
  onKeepEditing,
}: ProfileSyncGateDialogProps) {
  return (
    <Dialog
      open
      title="Update linked problems?"
      description={`This change will update ${pendingSync.affectedDrafts} ${
        pendingSync.affectedDrafts === 1 ? 'draft' : 'drafts'
      }${
        pendingSync.affectedPublishedProblems > 0
          ? ` — including ${pendingSync.affectedPublishedProblems} published ${
              pendingSync.affectedPublishedProblems === 1 ? 'problem' : 'problems'
            }`
          : ''
      } with the new author metadata and PDF.`}
      onClose={onKeepEditing}
      footer={
        <>
          <Button loading={saving} loadingLabel="Saving profile…" onClick={onConfirm}>
            Save and sync linked problems
          </Button>
          <Button variant="secondary" disabled={saving} onClick={onKeepEditing}>
            Keep editing
          </Button>
        </>
      }
    />
  );
}
