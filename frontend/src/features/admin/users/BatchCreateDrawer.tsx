import { useState } from 'react';
import { Copy, DownloadSimple } from '@phosphor-icons/react';
import { Button, Drawer, Field, InlineError, InlineNotice } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { downloadCsv } from '../../../utils/downloadCsv';
import type { BatchCreatedUser } from '../../../types';
import styles from './Users.module.css';

const MAX_BATCH = 200;

/** Create many student accounts at once; the passwords are shown exactly once (§7.8). */
export default function BatchCreateDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [prefix, setPrefix] = useState('');
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<BatchCreatedUser[] | null>(null);
  const n = Number(count);
  const valid = prefix.trim().length > 0 && Number.isInteger(n) && n >= 1 && n <= MAX_BATCH;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminService.createBatchUsers({ prefix: prefix.trim(), count: n });
      setCreated(result.users);
    } catch (err) {
      setError((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? "Couldn't create the users.");
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    setCreated(null);
    setPrefix('');
    setCount('');
    onDone();
  };

  if (created) {
    const rows = [['username', 'password'], ...created.map((u) => [u.username, u.password])];
    return (
      <Drawer open={open} title={`Created ${created.length} users`} onClose={finish}>
        <InlineNotice tone="warning" title="Save these passwords now.">They won&apos;t be shown again — you can only reset them later.</InlineNotice>
        <table className={styles.passwords}>
          <thead><tr><th scope="col">Username</th><th scope="col">Password</th></tr></thead>
          <tbody>{created.map((u) => <tr key={u.username}><td>{u.username}</td><td>{u.password}</td></tr>)}</tbody>
        </table>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(rows.map((r) => r.join('\t')).join('\n')); }}>
            <Copy size={14} aria-hidden="true" />Copy
          </Button>
          <Button variant="secondary" onClick={() => downloadCsv('new-users.csv', rows)}>
            <DownloadSimple size={14} aria-hidden="true" />Download CSV
          </Button>
          <Button onClick={finish}>Done</Button>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer open={open} title="Create users" onClose={onClose}>
      <p className={styles.lead}>Accounts are created as students with generated passwords.</p>
      {error && <InlineError message={error} />}
      <Field label="Username prefix" hint="Each account is the prefix plus a number, e.g. m42_01.">
        {(control) => <input {...control} className={styles.input} value={prefix} onChange={(e) => setPrefix(e.target.value)} />}
      </Field>
      <Field label="How many" hint={`1–${MAX_BATCH}`}>
        {(control) => <input {...control} type="number" min={1} max={MAX_BATCH} className={styles.input} value={count} onChange={(e) => setCount(e.target.value)} />}
      </Field>
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={!valid || busy} loading={busy} loadingLabel="Creating…">
          {valid ? `Create ${n} users` : 'Create users'}
        </Button>
      </div>
    </Drawer>
  );
}
