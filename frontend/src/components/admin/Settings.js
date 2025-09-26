import React, { useState, useEffect } from 'react';
import axios from 'axios';
import styles from './Settings.module.css'; // Updated CSS import
import { useSettings } from '../../context/SettingsContext';

const API_URL = process.env.REACT_APP_API_URL;

const Settings = () => { // Renamed component
  // Existing state for Registration Settings
  const [isRegistrationEnabled, setIsRegistrationEnabled] = useState(true);
  const [isLoadingRegistration, setIsLoadingRegistration] = useState(true);
  const [registrationError, setRegistrationError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState('');
  const { refreshSettings } = useSettings();

  // New state for Database Management
  const [databaseFile, setDatabaseFile] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [databaseError, setDatabaseError] = useState('');
  const [databaseSuccess, setDatabaseSuccess] = useState('');

  useEffect(() => {
    const fetchRegistrationSettings = async () => {
      try {
        const response = await axios.get(`${API_URL}/admin/settings/registration`, { withCredentials: true });
        setIsRegistrationEnabled(response.data.enabled);
      } catch (err) {
        setRegistrationError('Failed to fetch registration settings.');
      } finally {
        setIsLoadingRegistration(false);
      }
    };
    fetchRegistrationSettings();
  }, []);

  const handleRegistrationToggle = async () => {
    setRegistrationError('');
    setRegistrationSuccess('');
    const newStatus = !isRegistrationEnabled;
    try {
      await axios.put(`${API_URL}/admin/settings/registration`, 
        { enabled: newStatus }, 
        { withCredentials: true }
      );
      setIsRegistrationEnabled(newStatus);
      setRegistrationSuccess(`Registration has been ${newStatus ? 'enabled' : 'disabled'}.`);
      await refreshSettings();
      setTimeout(() => setRegistrationSuccess(''), 3000);
    } catch (err) {
      setRegistrationError('Failed to update registration settings.');
    }
  };

  const handleExportDatabase = async () => {
    setIsExporting(true);
    setDatabaseError('');
    setDatabaseSuccess('');
    try {
      const response = await axios.post(`${API_URL}/admin/database/export`, {}, {
        withCredentials: true,
        responseType: 'blob', // Important for downloading files
      });

      // Create a blob from the response
      const blob = new Blob([response.data], { type: 'application/sql' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `oj_backup_${Date.now()}.sql`); // Dynamic filename
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url); // Clean up

      setDatabaseSuccess('Database exported successfully!');
      setTimeout(() => setDatabaseSuccess(''), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setDatabaseError('Failed to export database.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = (event) => {
    setDatabaseFile(event.target.files[0]);
    setDatabaseError('');
  };

  const handleImportDatabase = async () => {
    if (!databaseFile) {
      setDatabaseError('Please select a database dump file to import.');
      return;
    }

    // Optional: client-side file type validation
    const allowedTypes = ['.sql', '.dump', '.tar'];
    const fileExtension = `.${databaseFile.name.split('.').pop().toLowerCase()}`;
    if (!allowedTypes.includes(fileExtension)) {
      setDatabaseError('Unsupported file type. Only .sql, .dump, or .tar files are allowed.');
      return;
    }

    if (!window.confirm("WARNING: Importing a database will PERMANENTLY DELETE all existing data and replace it with the content of the uploaded file. Are you absolutely sure you want to proceed? This action cannot be undone.")) {
      return;
    }

    setIsImporting(true);
    setDatabaseError('');
    setDatabaseSuccess('');

    const formData = new FormData();
    formData.append('databaseDump', databaseFile);

    try {
      await axios.post(`${API_URL}/admin/database/import`, formData, {
        withCredentials: true,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setDatabaseSuccess('Database imported successfully! You may need to refresh or re-login.');
      setDatabaseFile(null); // Clear selected file
      setTimeout(() => setDatabaseSuccess(''), 5000);
    } catch (err) {
      console.error('Import error:', err);
      setDatabaseError(`Failed to import database: ${err.response?.data?.message || err.message}`);
    } finally {
      setIsImporting(false);
    }
  };


  if (isLoadingRegistration) return <div>Loading settings...</div>;

  return (
    <div className={styles['settings-container']}>
      <h2>Admin Settings</h2>

      {/* Registration Settings */}
      <div className={styles['section-card']}>
        <h3>Registration</h3>
        {registrationError && <p className={styles['error-message']}>{registrationError}</p>}
        {registrationSuccess && <p className={styles['success-message']}>{registrationSuccess}</p>}
        <div className={styles['setting-item']}>
          <div>Enable User Registration</div>
          <label className={styles['toggle-switch']}>
            <input
              type="checkbox"
              id="registration-toggle"
              checked={isRegistrationEnabled}
              onChange={handleRegistrationToggle}
            />
            <span className={`${styles.slider} ${styles.round}`}></span>
          </label>
        </div>
      </div>

      {/* Database Management */}
      <div className={styles['section-card']}>
        <h3>Database Management</h3>
        {databaseError && <p className={styles['error-message']}>{databaseError}</p>}
        {databaseSuccess && <p className={styles['success-message']}>{databaseSuccess}</p>}

        {/* Export Section */}
        <div className={styles['setting-item']}>
          <div>Export Current Database</div>
          <button 
            onClick={handleExportDatabase} 
            disabled={isExporting}
            className={styles['action-button']}
          >
            {isExporting ? 'Exporting...' : 'Export Database'}
          </button>
        </div>

        {/* Import Section */}
        <div className={styles['setting-item']}>
          <div>Import Database</div>
          <input 
            type="file" 
            onChange={handleFileChange} 
            accept=".sql,.dump,.tar" 
            className={styles['file-input']}
          />
          {databaseFile && <p>Selected file: {databaseFile.name}</p>}
          <button 
            onClick={handleImportDatabase} 
            disabled={isImporting || !databaseFile}
            className={`${styles['action-button']} ${styles['import-button']}`}
          >
            {isImporting ? 'Importing...' : 'Upload & Import'}
          </button>
          <p className={styles['warning-message']}>
            WARNING: Importing a database will permanently delete all existing data and replace it. Proceed with caution.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings; 