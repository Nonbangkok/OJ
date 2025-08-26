import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './RegistrationSettings.css';

const API_URL = process.env.REACT_APP_API_URL;

const RegistrationSettings = () => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/admin/settings/registration`, { withCredentials: true });
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
      await axios.put(`${API_URL}/api/admin/settings/registration`, 
        { enabled: newStatus }, 
        { withCredentials: true }
      );
      setIsEnabled(newStatus);
      setSuccess(`Registration has been ${newStatus ? 'enabled' : 'disabled'}.`);
      setTimeout(() => setSuccess(''), 3000); // Clear message after 3 seconds
    } catch (err) {
      setError('Failed to update settings.');
    }
  };

  if (isLoading) return <div>Loading settings...</div>;

  return (
    <div className="settings-container">
      <h3>Registration Settings</h3>
      {error && <p className="error-message">{error}</p>}
      {success && <p className="success-message">{success}</p>}
      <div className="setting-item">
        <label htmlFor="registration-toggle">Enable User Registration</label>
        <div className="toggle-switch">
          <input
            type="checkbox"
            id="registration-toggle"
            checked={isEnabled}
            onChange={handleToggle}
          />
          <span className="slider round"></span>
        </div>
      </div>
    </div>
  );
};

export default RegistrationSettings; 