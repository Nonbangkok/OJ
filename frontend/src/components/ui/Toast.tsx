import { useCallback, useMemo, type ReactNode } from 'react';
import { Toast } from '@base-ui/react/toast';
import { CheckCircle, Info, X, XCircle } from '@phosphor-icons/react';
import styles from './Toast.module.css';

type Tone = 'neutral' | 'success' | 'danger';
const ICONS = { neutral: Info, success: CheckCircle, danger: XCircle } as const;
const TIMEOUT_MS = 4000;

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className={styles.viewport}>
        {toasts.map((toast) => {
          const tone = ((toast.type as Tone | undefined) ?? 'neutral');
          const Icon = ICONS[tone] ?? Info;
          return (
            <Toast.Root key={toast.id} toast={toast} className={styles.toast} data-tone={tone}>
              <Icon size={16} aria-hidden="true" className={styles.icon} />
              <Toast.Title className={styles.title} />
              <Toast.Close className={styles.close} aria-label="Dismiss"><X size={14} aria-hidden="true" /></Toast.Close>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

/** App-wide toasts ("Saved", "Job finished") on Base UI; auto-dismiss after 4s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={TIMEOUT_MS} limit={3}>
      {children}
      <ToastList />
    </Toast.Provider>
  );
}

export function useToast(): { show: (message: string, opts?: { tone?: Tone }) => void } {
  const manager = Toast.useToastManager();
  const show = useCallback((message: string, opts?: { tone?: Tone }) => {
    manager.add({ title: message, type: opts?.tone ?? 'neutral' });
  }, [manager]);
  return useMemo(() => ({ show }), [show]);
}
