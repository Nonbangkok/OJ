import type React from 'react';
import styles from './OverflowTable.module.css';

export interface OverflowTableProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  children: React.ReactNode;
}

export function OverflowTable({ label, className, children, ...props }: OverflowTableProps) {
  return (
    <div
      {...props}
      aria-label={label}
      className={[styles.container, className].filter(Boolean).join(' ')}
      role="region"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
