import { useState, ChangeEvent } from 'react';

interface AuthFormData {
  username: string;
  password: string;
}

interface UseAuthFormsReturn {
  formData: AuthFormData;
  error: string;
  setError: (error: string) => void;
  success: string;
  setSuccess: (success: string) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  handleChange: (e: ChangeEvent<HTMLInputElement>) => void;
  validate: () => boolean;
}

/**
 * Custom hook to handle common form logic for Auth (Login/Register)
 */
export const useAuthForms = (initialValues: AuthFormData = { username: '', password: '' }): UseAuthFormsReturn => {
    const [formData, setFormData] = useState<AuthFormData>(initialValues);
    const [error, setError] = useState<string>('');
    const [success, setSuccess] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);

    const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const { id, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [id]: value
        }));
    };

    const validate = (): boolean => {
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
        validate
    };
};
