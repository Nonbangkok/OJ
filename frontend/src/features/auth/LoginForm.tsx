import React, { FormEvent, ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import styles from '../../components/styles/Form.module.css';

interface LoginFormProps {
    formData: {
        username: string;
        password: string;
    };
    error: string;
    onSubmit: (e: FormEvent) => void;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    registrationEnabled: boolean;
}

const LoginForm: React.FC<LoginFormProps> = ({ formData, error, onSubmit, onChange, registrationEnabled }) => {
    return (
        <div className={styles['form-container']}>
            <h2>Login</h2>
            <form onSubmit={onSubmit}>
                {error && <p className={styles['error-message']}>{error}</p>}
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
                <button type="submit">Login</button>
            </form>
            {registrationEnabled && (
                <p className={styles['form-footer-link']}>
                    Don't have an account? <Link to="/register">Register here</Link>
                </p>
            )}
        </div>
    );
};

export default LoginForm;
