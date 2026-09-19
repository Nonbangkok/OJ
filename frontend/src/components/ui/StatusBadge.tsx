import type React from 'react';
import styles from './StatusBadge.module.css';

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  /** Borderless, compact pill for dense table cells. */
  soft?: boolean;
  children: React.ReactNode;
}

export function StatusBadge({ tone = 'neutral', soft = false, className, children, ...props }: StatusBadgeProps) {
  return (
    <span
      {...props}
      className={[styles.badge, styles[tone], soft ? styles.soft : '', className].filter(Boolean).join(' ')}
    >
      {children}
    </span>
  );
}
