import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useSettings } from '../context/SettingsContext';
import styles from '../components/Form.module.css';

const API_URL = process.env.REACT_APP_API_URL;

function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  const { registrationEnabled, isLoading } = useSettings();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (username.length < 3) {
      setError('Username must be at least 3 characters long.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    try {
      await axios.post(`${API_URL}/register`, {
        username,
        password,
      });
      setSuccess('Registration successful! Please log in.');
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Username or email might already be in use.');
    }
  };

  if (isLoading) {
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
      <h2>Register new page</h2>
      <form onSubmit={handleSubmit}>
        <div className={styles['form-group']}>
          <label htmlFor="username">Username:</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className={styles['form-group']}>
          <label htmlFor="password">Password:</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
}

export default Register; 