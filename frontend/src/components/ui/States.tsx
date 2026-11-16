import type { ReactNode } from 'react';
import { CheckCircle, Info, Warning, XCircle } from '@phosphor-icons/react';
import { Button } from './Button';
import styles from './States.module.css';

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {description && <p className={styles.emptyText}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <XCircle size={16} aria-hidden="true" className={styles.errorIcon} />
      <span className={styles.errorText}>{message}</span>
      {onRetry && <Button size="compact" variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

const ICONS = { neutral: Info, warning: Warning, danger: XCircle, success: CheckCircle } as const;

export function InlineNotice({ tone = 'neutral', title, children }: { tone?: keyof typeof ICONS; title?: ReactNode; children?: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <div className={styles.notice} data-tone={tone}>
      <Icon size={16} aria-hidden="true" className={styles.noticeIcon} />
      <div>
        {title && <p className={styles.noticeTitle}>{title}</p>}
        {children && <div className={styles.noticeBody}>{children}</div>}
      </div>
    </div>
  );
}
