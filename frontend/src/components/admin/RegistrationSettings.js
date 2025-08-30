import React, { useState, useEffect } from 'react';
import axios from 'axios';
import styles from './RegistrationSettings.module.css';
import { useSettings } from '../../context/SettingsContext';

const API_URL = process.env.REACT_APP_API_URL;

const RegistrationSettings = () => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { refreshSettings } = useSettings(); // Get the refresh function

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await axios.get(`${API_URL}/admin/settings/registration`, { withCredentials: true });
        setIsEnabled(response.data.enabled);
      } catch (err) {
        setError('Failed to fetch settings.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleToggle = async () => {
    setError('');
    setSuccess('');
    const newStatus = !isEnabled;
    try {
      await axios.put(`${API_URL}/admin/settings/registration`, 
        { enabled: newStatus }, 
        { withCredentials: true }
      );
      setIsEnabled(newStatus);
      setSuccess(`Registration has been ${newStatus ? 'enabled' : 'disabled'}.`);
      await refreshSettings(); // Refresh settings globally
      setTimeout(() => setSuccess(''), 3000); // Clear message after 3 seconds
    } catch (err) {
      setError('Failed to update settings.');
    }
  };

  if (isLoading) return <div>Loading settings...</div>;

  return (
    <div className={styles['settings-container']}>
      <h3>Registration Settings</h3>
      {error && <p className={styles['error-message']}>{error}</p>}
      {success && <p className={styles['success-message']}>{success}</p>}
      <div className={styles['setting-item']}>
        <div>Enable User Registration</div>
        {/* Change the div to a label to make the entire switch clickable */}
        <label className={styles['toggle-switch']}>
          <input
            type="checkbox"
            id="registration-toggle"
            checked={isEnabled}
            onChange={handleToggle}
          />
          <span className={`${styles.slider} ${styles.round}`}></span>
        </label>
      </div>
    </div>
  );
};

export default RegistrationSettings; 