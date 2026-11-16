import { ActionMenu } from './ActionMenu';
import { Button } from './Button';
import styles from './BulkBar.module.css';

export interface BulkAction {
  key: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

const VISIBLE = 3;

/** Appears only while rows are selected; destructive and overflow actions live in ⋯. */
export function BulkBar({ count, onClear, actions }: { count: number; onClear: () => void; actions: BulkAction[] }) {
  if (count <= 0) return null;
  const safe = actions.filter((a) => !a.destructive);
  const visible = safe.slice(0, VISIBLE);
  const overflow = [...safe.slice(VISIBLE), ...actions.filter((a) => a.destructive)];
  return (
    <div role="region" aria-label="Bulk actions" className={styles.bar}>
      <span className={styles.count}>{count} selected</span>
      <button type="button" className={styles.clear} onClick={onClear}>Clear</button>
      <span className={styles.sep} aria-hidden="true" />
      {visible.map((a) => (
        <Button key={a.key} size="compact" variant="secondary" onClick={a.onClick}>{a.label}</Button>
      ))}
      {overflow.length > 0 && (
        <ActionMenu
          label="More bulk actions"
          items={overflow.map((a) => ({ key: a.key, label: a.label, onClick: a.onClick, variant: a.destructive ? 'danger' : 'default' }))}
        />
      )}
    </div>
  );
}

export default BulkBar;
