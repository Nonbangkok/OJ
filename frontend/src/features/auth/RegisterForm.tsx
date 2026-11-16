import { Link } from 'react-router-dom';
import type { ChangeEvent, FormEvent } from 'react';
import { Button, Field, InlineError } from '../../components/ui';
import type { AuthFieldErrors } from '../../hooks/useAuthForms';
import PasswordInput from './PasswordInput';
import styles from './AuthForm.module.css';

interface RegisterFormProps {
  formData: Record<string, string>;
  error: string;
  fieldErrors?: AuthFieldErrors;
  loading?: boolean;
  onSubmit: (event: FormEvent) => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  registrationEnabled: boolean;
  isLoadingSettings?: boolean;
}

const RegisterForm = ({
  formData, error, fieldErrors = {}, loading = false, onSubmit, onChange, registrationEnabled, isLoadingSettings = false,
}: RegisterFormProps) => {
  if (isLoadingSettings) {
    return <div className={styles.card}><p className={styles.muted} role="status">Loading…</p></div>;
  }
  if (!registrationEnabled) {
    return (
      <div className={styles.card}>
        <h1 className={styles.title}>Registration is closed</h1>
        <p className={styles.muted}>New accounts can&apos;t be created right now. Ask your teacher for an account.</p>
        <p className={styles.footer}>Already have an account? <Link to="/login">Log in</Link></p>
      </div>
    );
  }
  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Create account</h1>
      {error && <InlineError message={error} />}
      <form onSubmit={onSubmit} className={styles.form} noValidate>
        <Field label="Username" hint="At least 3 characters." error={fieldErrors.username}>
          {(control) => (
            <input {...control} name="username" type="text" autoComplete="username" className={styles.input}
              value={formData.username ?? ''} onChange={onChange} required />
          )}
        </Field>
        <Field label="Password" hint="At least 6 characters." error={fieldErrors.password}>
          {(control) => (
            <PasswordInput {...control} name="password" autoComplete="new-password"
              value={formData.password ?? ''} onChange={onChange} required />
          )}
        </Field>
        <Field label="Confirm password" error={fieldErrors.confirmPassword}>
          {(control) => (
            <PasswordInput {...control} name="confirmPassword" autoComplete="new-password"
              value={formData.confirmPassword ?? ''} onChange={onChange} required />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={loading} loading={loading} loadingLabel="Creating account…" className={styles.submit}>
          Create account
        </Button>
      </form>
      <p className={styles.footer}>Already have an account? <Link to="/login">Log in</Link></p>
    </div>
  );
};

export default RegisterForm;
