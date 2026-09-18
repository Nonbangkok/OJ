import type React from 'react';
import styles from './OverflowTable.module.css';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- A named scrollable region needs keyboard focus so keyboard users can scroll wide tables; jsx-a11y does not model this scroll-region pattern. */

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
