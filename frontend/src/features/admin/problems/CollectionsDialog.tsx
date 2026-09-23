import { useState } from 'react';
import { Button, Dialog } from '../../../components/ui';
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

/** Create / rename / delete collections. Derived visibility status is shown
 *  read-only — the real visibility lives on the problems themselves. */
export default function CollectionsDialog({ open, onClose, onChanged, collections }: CollectionsDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<CollectionWithStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName(''); setDescription(''); setEditing(null); setError('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      if (editing) {
        await adminService.updateCollection(editing.id, name.trim(), description.trim() || null);
      } else {
        await adminService.createCollection(name.trim(), description.trim() || null);
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
    setDescription(collection.description ?? '');
    setError('');
  };

  const remove = async (collection: CollectionWithStats) => {
    if (busy) return;
    const confirmed = window.confirm(
      `Delete collection "${collection.name}"? Its ${collection.problem_count} problem` +
      `${collection.problem_count === 1 ? '' : 's'} will move to No Collection (nothing is deleted).`,
    );
    if (!confirmed) return;
    setBusy(true); setError('');
    try {
      await adminService.deleteCollection(collection.id);
      if (editing?.id === collection.id) reset();
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
      onClose={() => { if (!busy) { reset(); onClose(); } }}
    >
      {error && <p role="alert">{error}</p>}
      <form onSubmit={submit}>
        <div className="form-group">
          <label htmlFor="collection-name">Name</label>
          <input
            id="collection-name"
            value={name}
            maxLength={100}
            required
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="collection-description">Description (optional)</label>
          <input
            id="collection-description"
            value={description}
            maxLength={500}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy} loading={busy}>
          {editing ? 'Save Changes' : 'Create Collection'}
        </Button>
        {editing && (
          <Button variant="secondary" disabled={busy} onClick={() => reset()}>Cancel Edit</Button>
        )}
      </form>

      <ul className={styles.collectionList}>
        {collections.map((collection) => (
          <li key={collection.id} className={styles.collectionRow}>
            <span className={styles.collectionName}>{collection.name}</span>
            <span className={styles.collectionCount}>{collection.problem_count} problems</span>
            <span className={styles.collectionStatus}>{STATUS_LABEL[collection.status]}</span>
            <span className={styles.collectionActions}>
              <Button size="compact" variant="secondary" disabled={busy} onClick={() => startEdit(collection)}>
                Edit
              </Button>
              <Button size="compact" variant="destructive" disabled={busy} onClick={() => remove(collection)}>
                Delete
              </Button>
            </span>
          </li>
        ))}
        {!collections.length && <li className={styles.emptyRow}>No collections yet.</li>}
      </ul>
    </Dialog>
  );
}
