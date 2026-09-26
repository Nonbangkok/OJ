import { useState } from 'react';
import { Button, Dialog, Field, Input, StatusBadge } from '../../../components/ui';
import adminService from '../../../services/adminService';
import type { CollectionWithStats } from '../../../services/admin/problemsAdminService';
import styles from './CollectionsDialog.module.css';

interface CollectionsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after any mutation so the parent can refresh problems + collections. */
  onChanged: () => void | Promise<void>;
  collections: CollectionWithStats[];
}

const STATUS_LABEL: Record<CollectionWithStats['status'], string> = {
  empty: 'Empty',
  all_visible: 'All Visible',
  all_hidden: 'All Hidden',
  mixed: 'Mixed',
};

const STATUS_TONE: Record<CollectionWithStats['status'], 'neutral' | 'success' | 'warning' | 'info'> = {
  empty: 'neutral',
  all_visible: 'success',
  all_hidden: 'warning',
  mixed: 'info',
};

/** Create / rename / delete collections. Derived visibility status is shown
 *  read-only — the real visibility lives on the problems themselves. */
export default function CollectionsDialog({ open, onClose, onChanged, collections }: CollectionsDialogProps) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<CollectionWithStats | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CollectionWithStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName(''); setEditing(null); setError('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      if (editing) {
        await adminService.updateCollection(editing.id, name.trim());
      } else {
        await adminService.createCollection(name.trim());
      }
      reset();
      await onChanged();
    } catch (err) {
      setError(err?.response?.data?.message ?? 'Could not save the collection');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (collection: CollectionWithStats) => {
    setEditing(collection);
    setName(collection.name);
    setError('');
  };

  const confirmDelete = async () => {
    if (busy || !pendingDelete) return;
    setBusy(true); setError('');
    try {
      await adminService.deleteCollection(pendingDelete.id);
      if (editing?.id === pendingDelete.id) reset();
      setPendingDelete(null);
      await onChanged();
    } catch (err) {
      setError(err?.response?.data?.message ?? 'Could not delete the collection');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Manage Collections"
      onClose={() => { if (!busy) { reset(); setPendingDelete(null); onClose(); } }}
    >
      <section className={styles.section} aria-labelledby="collections-form-heading">
        <h3 id="collections-form-heading" className={styles.sectionTitle}>
          {editing ? 'Edit Collection' : 'Create a collection'}
        </h3>
        <p className={styles.sectionHint}>
          Group problems so they can be filtered and shown/hidden together.
        </p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <form className={styles.form} onSubmit={submit}>
          <Field label="Name" required>
            {({ id, ...controlProps }) => (
              <Input
                {...controlProps}
                id={id}
                value={name}
                maxLength={100}
                required
                disabled={busy}
                placeholder="Collection name"
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <div className={styles.formActions}>
            {editing && (
              <Button type="button" variant="secondary" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={busy} loading={busy}>
              {editing ? 'Save Changes' : 'Create Collection'}
            </Button>
          </div>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="collections-list-heading">
        <h3 id="collections-list-heading" className={styles.sectionTitle}>Collections</h3>
        <ul className={styles.collectionList}>
          {collections.map((collection) => (
            <li
              key={collection.id}
              className={`${styles.collectionRow}${editing?.id === collection.id ? ` ${styles.collectionRowEditing}` : ''}`}
            >
              <div className={styles.collectionIdentity}>
                <span className={styles.collectionName} title={collection.name}>{collection.name}</span>
                <span className={styles.collectionMeta}>
                  {collection.problem_count} problem{collection.problem_count === 1 ? '' : 's'}
                </span>
              </div>
              <StatusBadge tone={STATUS_TONE[collection.status]} soft>
                {STATUS_LABEL[collection.status]}
              </StatusBadge>
              <div className={styles.collectionActions}>
                <Button size="compact" variant="secondary" disabled={busy} onClick={() => startEdit(collection)}>
                  Edit
                </Button>
                <Button size="compact" variant="destructive" disabled={busy} onClick={() => setPendingDelete(collection)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
          {!collections.length && <li className={styles.emptyRow}>No collections yet.</li>}
        </ul>
      </section>

      {pendingDelete && (
        <div className={styles.deleteConfirm} role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <h4 id="delete-confirm-title" className={styles.deleteConfirmTitle}>
            Delete “{pendingDelete.name}”?
          </h4>
          <p className={styles.deleteConfirmText}>
            Problems in this collection will not be deleted.
            {' '}They will move to No Collection.
          </p>
          <div className={styles.deleteConfirmActions}>
            <Button variant="secondary" disabled={busy} onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} loading={busy} onClick={confirmDelete}>
              Delete Collection
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
