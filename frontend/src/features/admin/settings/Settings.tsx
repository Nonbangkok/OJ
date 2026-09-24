import useAdminSettings from '../../../hooks/admin/useAdminSettings';
import { Button } from '../../../components/ui';
import styles from './Settings.module.css'; // Updated CSS import
import { useSettings } from '../../../context/SettingsContext';

const Settings = () => { // Renamed component
  const {
    isRegistrationEnabled,
    isLoadingRegistration,
    registrationError,
    registrationSuccess,
    siteAccessMode,
    isSavingAccessMode,
    accessModeError,
    accessModeSuccess,
    handleSiteAccessModeChange,
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

      {/* Site Access */}
      <div className={styles['section-card']}>
        <h3>Site Access</h3>
        {accessModeError && <p className={styles['error-message']}>{accessModeError}</p>}
        {accessModeSuccess && <p className={styles['success-message']}>{accessModeSuccess}</p>}

        <fieldset className={styles['setting-item']} disabled={isSavingAccessMode}>
          <legend>Website access</legend>
          <label className={styles['radio-option']} htmlFor="site-access-mode-public">
            <input
              type="radio"
              id="site-access-mode-public"
              name="site-access-mode"
              value="public"
              checked={siteAccessMode === 'public'}
              onChange={() => handleSiteAccessModeChange('public')}
            />
            <strong>Public</strong>
            <em className={styles['option-description']}>
              Visitors can browse public OJ content without signing in.
              Submitting and personal actions still require authentication.
            </em>
          </label>
          <label className={styles['radio-option']} htmlFor="site-access-mode-private">
            <input
              type="radio"
              id="site-access-mode-private"
              name="site-access-mode"
              value="private"
              checked={siteAccessMode === 'private'}
              onChange={() => handleSiteAccessModeChange('private')}
            />
            <strong>Private</strong>
            <em className={styles['option-description']}>
              Users must sign in before accessing OJ content.
            </em>
          </label>
        </fieldset>

        <p className={styles['current-mode']}>Current mode: {siteAccessMode === 'private' ? 'Private' : 'Public'}</p>
      </div>

      {/* Registration Settings */}
      <div className={styles['section-card']}>
        <h3>Registration</h3>
        {registrationError && <p className={styles['error-message']}>{registrationError}</p>}
        {registrationSuccess && <p className={styles['success-message']}>{registrationSuccess}</p>}
        <div className={styles['setting-item']}>
          <label htmlFor="registration-toggle">Enable User Registration</label>
          <span className={styles['toggle-switch']}>
            <input
              type="checkbox"
              id="registration-toggle"
              aria-label="Enable user registration"
              checked={isRegistrationEnabled}
              onChange={handleRegistrationToggle}
            />
            <span className={`${styles.slider} ${styles.round}`}></span>
          </span>
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
          <Button
            onClick={handleExportDatabase}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting…' : 'Export Database'}
          </Button>
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
          <Button
            variant="destructive"
            onClick={handleImportDatabase}
            disabled={isImporting || !databaseFile}
          >
            {isImporting ? 'Importing…' : 'Upload & Import'}
          </Button>
          <p className={styles['warning-message']}>
            WARNING: Importing a database will permanently delete all existing data and replace it. Proceed with caution.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings; 