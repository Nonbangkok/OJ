import { useState } from 'react';
import type { ChangeEvent } from 'react';

type AuthField = 'username' | 'password' | 'confirmPassword';
export type AuthFieldErrors = Partial<Record<AuthField, string>>;

/**
 * Shared form state for Login and Register. Inputs are matched by `name`.
 * `validate` reports problems under the field they belong to; `error` is
 * for the server's answer (shown as a form-level alert).
 */
export const useAuthForms = (initialValues: Partial<Record<AuthField, string>> = { username: '', password: '' }) => {
  const [formData, setFormData] = useState<Record<string, string>>(initialValues as Record<string, string>);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const key = e.target.name || e.target.id;
    const { value } = e.target;
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key as AuthField] ? { ...prev, [key]: undefined } : prev));
  };

  const validate = () => {
    const next: AuthFieldErrors = {};
    if ((formData.username ?? '').length < 3) {
      next.username = 'Username must be at least 3 characters long.';
    }
    if ((formData.password ?? '').length < 6) {
      next.password = 'Password must be at least 6 characters long.';
    }
    if ('confirmPassword' in formData && formData.confirmPassword !== formData.password) {
      next.confirmPassword = "Passwords don't match.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  return {
    formData,
    error,
    setError,
    fieldErrors,
    success,
    setSuccess,
    loading,
    setLoading,
    handleChange,
    validate,
  };
};
