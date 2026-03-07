import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useAuthForms } from '../../hooks/useAuthForms';
import authService from '../../services/authService';
import LoginForm from '../../features/auth/LoginForm';

const Login = () => {
  const { login } = useAuth();
  const { registrationEnabled } = useSettings();
  const navigate = useNavigate();

  const { formData, error, setError, handleChange, setLoading } = useAuthForms();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      const data = await authService.login(formData.username, formData.password);
      login(data.user);
      navigate('/');
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
      onSubmit={handleSubmit}
      onChange={handleChange}
      registrationEnabled={registrationEnabled}
    />
  );
};

export default Login;
