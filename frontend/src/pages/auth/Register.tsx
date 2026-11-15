import { useNavigate } from 'react-router-dom';
import authService from '../../services/authService';
import { useSettings } from '../../context/SettingsContext';
import { useAuthForms } from '../../hooks/useAuthForms';
import RegisterForm from '../../features/auth/RegisterForm';

const Register = () => {
  const navigate = useNavigate();
  const { registrationEnabled, isLoading: isLoadingSettings } = useSettings();

  const {
    formData, error, setError,
    handleChange, validate, loading, setLoading
  } = useAuthForms();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    try {
      setLoading(true);
      await authService.register(formData.username, formData.password);
      // This page unmounts on navigate, so the success notice is shown by the
      // login page, signalled through the navigation state.
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Username or email might already be in use.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <RegisterForm
      formData={formData}
      error={error}
      loading={loading}
      onSubmit={handleSubmit}
      onChange={handleChange}
      registrationEnabled={registrationEnabled}
      isLoadingSettings={isLoadingSettings}
    />
  );
}

export default Register;
