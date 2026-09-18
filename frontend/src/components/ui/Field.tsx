import { useId } from 'react';
import type React from 'react';
import styles from './Field.module.css';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: FieldControlProps) => React.ReactNode;
}

export function Field({ label, hint, error, required = false, children }: FieldProps) {
  const generatedId = useId();
  const controlId = `field-${generatedId}`;
  const hintId = `field-hint-${generatedId}`;
  const errorId = `field-error-${generatedId}`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <div className={styles.label}>
        <label htmlFor={controlId}>{label}</label>
        {required ? <span className={styles.required} aria-hidden="true">*</span> : null}
      </div>
      {children({
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
      {error ? <p id={errorId} className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
