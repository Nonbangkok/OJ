import { useId, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  tier: 'plain' | 'destructive' | 'typed';
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** For `typed`: the exact text (case-sensitive, untrimmed) the user must type. */
  confirmText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation in three tiers: reversible, destructive, and type-the-name for cascading deletes. */
export function ConfirmDialog({ open, tier, title, body, confirmLabel, confirmText = '', busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const ready = tier !== 'typed' || typed === confirmText;
  const variant = tier === 'plain' ? 'primary' : 'destructive';
  const confirm = () => { if (ready && !busy) onConfirm(); };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={variant} onClick={confirm} disabled={!ready || busy} loading={busy}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className={styles.body}>{body}</div>
      {tier === 'typed' && (
        <div className={styles.typed}>
          <label htmlFor={inputId}>Type <b>{confirmText}</b> to confirm</label>
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
            className={styles.input}
          />
        </div>
      )}
    </Dialog>
  );
}

export default ConfirmDialog;
