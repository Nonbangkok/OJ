import type { ReactNode } from 'react';
import { Check } from '@phosphor-icons/react';
import styles from './SettingsRow.module.css';

export interface SettingsRowProps {
  label: string;
  help?: ReactNode;
  control: ReactNode;
  htmlFor?: string;
  status?: 'saving' | 'saved' | null;
  danger?: boolean;
}

/** Label + help on the left, the control on the right (also on phones). */
export function SettingsRow({ label, help, control, htmlFor, status = null, danger = false }: SettingsRowProps) {
  return (
    <div className={styles.row} data-danger={danger ? 'true' : undefined}>
      <div className={styles.text}>
        {htmlFor ? <label htmlFor={htmlFor} className={styles.label}>{label}</label> : <span className={styles.label}>{label}</span>}
        {help && <p className={styles.help}>{help}</p>}
      </div>
      <div className={styles.control}>
        {status === 'saving' && <span className={styles.status}>Saving…</span>}
        {status === 'saved' && <span className={styles.status}><Check size={12} weight="bold" aria-hidden="true" />Saved</span>}
        {control}
      </div>
    </div>
  );
}

export default SettingsRow;
