import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useAuthForms } from '../../hooks/useAuthForms';
import authService from '../../services/authService';
import LoginForm from '../../features/auth/LoginForm';
import { safeReturnTo } from '../../utils/safeReturnTo';

const Login = () => {
  const { login } = useAuth();
  const { registrationEnabled } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  // Register redirects here with `{ registered: true }` state after a
  // successful sign-up.
  const justRegistered = (location.state as { registered?: boolean } | null)?.registered === true;

  // The session-expiry interceptor in services/api.ts redirects here with
  // ?expired=1&returnTo=<original path> when a mid-session 401 happens.
  const { isSessionExpired, returnTo } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const returnParam = params.get('returnTo');
    return {
      isSessionExpired: params.get('expired') === '1',
      // Only same-site paths are honoured so the param cannot be abused as an open redirect.
      returnTo: safeReturnTo(returnParam),
    };
  }, [location.search]);

  const { formData, error, setError, handleChange, loading, setLoading } = useAuthForms();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      const data = await authService.login(formData.username, formData.password);
      login(data.user);
      navigate(returnTo);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginForm
      formData={formData}
      error={error}
      loading={loading}
      onSubmit={handleSubmit}
      onChange={handleChange}
      registrationEnabled={registrationEnabled}
      sessionExpired={isSessionExpired}
      justRegistered={justRegistered}
    />
  );
};

export default Login;
