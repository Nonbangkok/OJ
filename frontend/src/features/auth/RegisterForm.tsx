import React, { FormEvent, ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import styles from '../../components/styles/Form.module.css';

interface RegisterFormProps {
    formData: {
        username: string;
        password: string;
    };
    error: string;
    success: string;
    onSubmit: (e: FormEvent) => void;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    registrationEnabled: boolean;
    isLoadingSettings: boolean;
}

const RegisterForm: React.FC<RegisterFormProps> = ({
    formData,
    error,
    success,
    onSubmit,
    onChange,
    registrationEnabled,
    isLoadingSettings
}) => {
    if (isLoadingSettings) {
        return <div className={styles['form-container']}><h2>Loading...</h2></div>;
    }

    if (!registrationEnabled) {
        return (
            <div className={styles['form-container']}>
                <h2>Registration Disabled</h2>
                <p>User registration is currently disabled. Please try again later.</p>
                <p className={styles['form-footer-link']}>
                    Already have an account? <Link to="/login">Login here</Link>
                </p>
            </div>
        );
    }

    return (
        <div className={styles['form-container']}>
            <h2>Register</h2>
            <form onSubmit={onSubmit}>
                <div className={styles['form-group']}>
                    <label htmlFor="username">Username</label>
                    <input
                        type="text"
                        id="username"
                        value={formData.username}
                        onChange={onChange}
                        required
                    />
                </div>
                <div className={styles['form-group']}>
                    <label htmlFor="password">Password</label>
                    <input
                        type="password"
                        id="password"
                        value={formData.password}
                        onChange={onChange}
                        required
                    />
                </div>
                {error && <p className={styles['error-message']}>{error}</p>}
                {success && <p className={styles['success-message']}>{success}</p>}
                <button type="submit" className={styles['form-button']}>
                    Register
                </button>
            </form>
            <p className={styles['form-footer-link']}>
                Already have an account? <Link to="/login">Login here</Link>
            </p>
        </div>
    );
};

export default RegisterForm;
