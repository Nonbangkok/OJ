import { useId } from 'react';
import type React from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'neutral' | 'destructive';
  size?: 'compact' | 'default';
  loading?: boolean;
  loadingLabel?: string;
  disabledReason?: string;
}

const loadingLabels: Record<string, string> = {
  add: 'Adding…',
  create: 'Creating…',
  delete: 'Deleting…',
  publish: 'Publishing…',
  save: 'Saving…',
  update: 'Updating…',
};

function getLoadingLabel(children: React.ReactNode, loadingLabel?: string) {
  if (loadingLabel) {
    return loadingLabel;
  }

  if (typeof children === 'string') {
    const action = children.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (action && loadingLabels[action]) {
      return loadingLabels[action];
    }
  }

  return 'Loading…';
}

export function Button({
  variant = 'primary',
  size = 'default',
  loading = false,
  loadingLabel,
  disabledReason,
  type = 'button',
  disabled = false,
  className,
  children,
  'aria-describedby': ariaDescribedBy,
  ...props
}: ButtonProps) {
  const reasonId = useId();
  const describedBy = [ariaDescribedBy, disabledReason ? reasonId : undefined].filter(Boolean).join(' ') || undefined;
  const button = (
    <button
      {...props}
      type={type}
      className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-describedby={describedBy}
    >
      {loading ? getLoadingLabel(children, loadingLabel) : children}
    </button>
  );

  if (!disabledReason) {
    return button;
  }

  return (
    <span className={styles.reasonWrapper}>
      {button}
      <span id={reasonId} className={styles.reason}>
        {disabledReason}
      </span>
    </span>
  );
}
