import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import styles from './AuthForm.module.css';

/** Password input with a Show/Hide toggle (aria-pressed). */
export default function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <span className={styles.passwordWrap}>
      <input {...props} type={visible ? 'text' : 'password'} className={styles.input} />
      <button
        type="button"
        className={styles.reveal}
        aria-pressed={visible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}
