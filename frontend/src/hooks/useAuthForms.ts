import { useState } from 'react';

/**
 * Custom hook to handle common form logic for Auth (Login/Register)
 */
export const useAuthForms = (initialValues = { username: '', password: '' }) => {
  const [formData, setFormData] = useState(initialValues);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [id]: value,
    }));
  };

  const validate = (type) => {
    if (formData.username.length < 3) {
      setError('Username must be at least 3 characters long.');
      return false;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return false;
    }
    return true;
  };

  return {
    formData,
    error,
    setError,
    success,
    setSuccess,
    loading,
    setLoading,
    handleChange,
    validate,
  };
};
