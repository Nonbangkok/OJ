import { Link } from 'react-router-dom';
import type { ChangeEvent, FormEvent } from 'react';
import { Button, Field, InlineError, InlineNotice } from '../../components/ui';
import PasswordInput from './PasswordInput';
import styles from './AuthForm.module.css';

interface LoginFormProps {
  formData: Record<string, string>;
  error: string;
  loading?: boolean;
  onSubmit: (event: FormEvent) => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  registrationEnabled: boolean;
  sessionExpired?: boolean;
  justRegistered?: boolean;
}

const LoginForm = ({
  formData, error, loading = false, onSubmit, onChange, registrationEnabled, sessionExpired = false, justRegistered = false,
}: LoginFormProps) => (
  <div className={styles.card}>
    <h1 className={styles.title}>Log in</h1>
    {sessionExpired && (
      <div role="status"><InlineNotice tone="warning">Your session expired. Please log in again.</InlineNotice></div>
    )}
    {justRegistered && !sessionExpired && (
      <div role="status"><InlineNotice tone="success">Account created. Log in with your new username.</InlineNotice></div>
    )}
    {error && <InlineError message={error} />}
    <form onSubmit={onSubmit} className={styles.form}>
      <Field label="Username">
        {(control) => (
          <input {...control} name="username" type="text" autoComplete="username" className={styles.input}
            value={formData.username ?? ''} onChange={onChange} required />
        )}
      </Field>
      <Field label="Password">
        {(control) => (
          <PasswordInput {...control} name="password" autoComplete="current-password"
            value={formData.password ?? ''} onChange={onChange} required />
        )}
      </Field>
      <Button type="submit" variant="primary" disabled={loading} loading={loading} loadingLabel="Logging in…" className={styles.submit}>
        Log in
      </Button>
    </form>
    {registrationEnabled && (
      <p className={styles.footer}>
        No account? <Link to="/register">Create one</Link>
      </p>
    )}
  </div>
);

export default LoginForm;
