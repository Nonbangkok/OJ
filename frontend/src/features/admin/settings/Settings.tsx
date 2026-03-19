import useAdminSettings from '../../../hooks/admin/useAdminSettings';
import styles from './Settings.module.css'; // Updated CSS import

const Settings = () => { // Renamed component
  const {
    isRegistrationEnabled,
    isLoadingRegistration,
    registrationError,
    registrationSuccess,
    databaseFile,
    isExporting,
    isImporting,
    databaseError,
    databaseSuccess,
    handleRegistrationToggle,
    handleExportDatabase,
    handleFileChange,
    handleImportDatabase
  } = useAdminSettings();


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