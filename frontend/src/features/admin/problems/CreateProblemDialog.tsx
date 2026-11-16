import { useState } from 'react';
import { Button, Dialog, Field, InlineError } from '../../../components/ui';
import adminService from '../../../services/adminService';
import styles from '../shared/Management.module.css';

const DEFAULT_TIME_LIMIT_MS = 1000;
const DEFAULT_MEMORY_LIMIT_MB = 256;

/**
 * New problem (§7.8): a small dialog for the id and title only; everything
 * else (limits, author, difficulty, statement, testcases) is set on the
 * problem's own page, which this opens.
 */
export default function CreateProblemDialog({ open, author, onClose, onCreated }: {
  open: boolean;
  author: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminService.createProblem({
        id: id.trim(), title: title.trim(), author: author || 'staff', difficulty: null,
        time_limit_ms: DEFAULT_TIME_LIMIT_MS, memory_limit_mb: DEFAULT_MEMORY_LIMIT_MB,
      });
      const created = id.trim();
      setId('');
      setTitle('');
      onCreated(created);
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { message?: string } } }).response;
      setError(response?.status === 409 ? 'Problem id already exists.' : response?.data?.message ?? "Couldn't create the problem.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="New problem" onClose={onClose}>
      {error && <InlineError message={error} />}
      <Field label="Problem id" hint="Letters, digits and underscores; it becomes part of the URL.">
        {(control) => <input {...control} className={styles['dialog-input']} value={id} onChange={(e) => setId(e.target.value)} />}
      </Field>
      <Field label="Title">
        {(control) => <input {...control} className={styles['dialog-input']} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <div className={styles['dialog-footer']}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={busy || !id.trim() || !title.trim()} loading={busy} loadingLabel="Creating…">Create problem</Button>
      </div>
    </Dialog>
  );
}
