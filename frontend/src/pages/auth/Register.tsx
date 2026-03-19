import { useNavigate } from 'react-router-dom';
import authService from '../../services/authService';
import { useSettings } from '../../context/SettingsContext';
import { useAuthForms } from '../../hooks/useAuthForms';
import RegisterForm from '../../features/auth/RegisterForm';

const Register = () => {
  const navigate = useNavigate();
  const { registrationEnabled, isLoading: isLoadingSettings } = useSettings();

  const {
    formData, error, setError, success, setSuccess,
    handleChange, validate, setLoading
  } = useAuthForms();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validate()) return;

    try {
      setLoading(true);
      await authService.register(formData.username, formData.password);
      setSuccess('Registration successful! Please log in.');
      navigate('/login');
    } catch (err) {
      setError((err as any).response?.data?.message || 'Registration failed. Username or email might already be in use.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <RegisterForm
      formData={formData}
      error={error}
      success={success}
      onSubmit={handleSubmit}
      onChange={handleChange}
      registrationEnabled={registrationEnabled}
      isLoadingSettings={isLoadingSettings}
    />
  );
}

export default Register;
