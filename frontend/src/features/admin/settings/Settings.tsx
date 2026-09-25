import { useState } from 'react';
import useAdminSettings from '../../../hooks/admin/useAdminSettings';
import { Button } from '../../../components/ui';
import ConfirmationModal from '../shared/ConfirmationModal';
import styles from './Settings.module.css';

const Settings = () => {
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

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  if (isLoadingRegistration) return <div>Loading settings...</div>;

  const handleConfirmImport = async () => {
    await handleImportDatabase();
    setIsImportModalOpen(false);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Admin Settings</h1>

      {/* Site Access */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Site Access</h2>
        <p className={styles.sectionDescription}>Control who can access this Grader.</p>

        {accessModeError && <p className={`${styles.statusMessage} ${styles.statusError}`}>{accessModeError}</p>}
        {accessModeSuccess && <p className={`${styles.statusMessage} ${styles.statusSuccess}`}>{accessModeSuccess}</p>}

        <fieldset className={styles.accessGroup} disabled={isSavingAccessMode}>
          <legend className={styles.groupTitle}>Website visibility</legend>

          <div className={styles.accessOptions}>
            <label
              className={`${styles.accessOption}${siteAccessMode === 'public' ? ` ${styles.accessOptionSelected}` : ''}`}
              htmlFor="site-access-mode-public"
            >
              <input
                type="radio"
                id="site-access-mode-public"
                name="site-access-mode"
                value="public"
                checked={siteAccessMode === 'public'}
                onChange={() => handleSiteAccessModeChange('public')}
              />
              <span className={styles.optionTitle}>Public</span>
              <span className={styles.optionDescription}>
                Anyone can browse public OJ content without signing in. Submitting and personal actions still require
                authentication.
              </span>
            </label>

            <label
              className={`${styles.accessOption}${siteAccessMode === 'private' ? ` ${styles.accessOptionSelected}` : ''}`}
              htmlFor="site-access-mode-private"
            >
              <input
                type="radio"
                id="site-access-mode-private"
                name="site-access-mode"
                value="private"
                checked={siteAccessMode === 'private'}
                onChange={() => handleSiteAccessModeChange('private')}
              />
              <span className={styles.optionTitle}>Private</span>
              <span className={styles.optionDescription}>Users must sign in before accessing Grader content.</span>
            </label>
          </div>
        </fieldset>

        <p className={styles.currentMode}>Current mode: {siteAccessMode === 'private' ? 'Private' : 'Public'}</p>
      </section>

      {/* Registration */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Registration</h2>
        <p className={styles.sectionDescription}>Control whether new accounts can be created.</p>

        {registrationError && (
          <p className={`${styles.statusMessage} ${styles.statusError}`}>{registrationError}</p>
        )}
        {registrationSuccess && (
          <p className={`${styles.statusMessage} ${styles.statusSuccess}`}>{registrationSuccess}</p>
        )}

        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <label htmlFor="registration-toggle" className={styles.settingTitle}>
              Allow user registration
            </label>
            <p className={styles.settingDescription}>Users can create their own accounts.</p>
          </div>
          <label className={styles.toggleSwitch} htmlFor="registration-toggle">
            <input
              type="checkbox"
              id="registration-toggle"
              aria-label="Allow user registration"
              checked={isRegistrationEnabled}
              onChange={handleRegistrationToggle}
            />
            <span className={styles.toggleTrack} aria-hidden="true"></span>
          </label>
        </div>
      </section>

      {/* Database */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Database</h2>
        <p className={styles.sectionDescription}>Back up or replace the Grader database.</p>

        {databaseError && <p className={`${styles.statusMessage} ${styles.statusError}`}>{databaseError}</p>}
        {databaseSuccess && <p className={`${styles.statusMessage} ${styles.statusSuccess}`}>{databaseSuccess}</p>}

        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <div className={styles.settingTitle}>Export database</div>
            <p className={styles.settingDescription}>Download a backup of the current database.</p>
          </div>
          <Button
            variant="secondary"
            onClick={handleExportDatabase}
            loading={isExporting}
            loadingLabel="Exporting…"
          >
            Export Database
          </Button>
        </div>

        <div className={styles.dangerZone}>
          <h3 className={styles.dangerZoneTitle}>Danger Zone</h3>
          <div className={styles.settingTitle}>Import Database</div>
          <p className={styles.settingDescription}>
            Importing a database replaces all existing data. This action cannot be undone.
          </p>

          <input
            type="file"
            onChange={handleFileChange}
            accept=".sql,.dump,.tar"
            className={styles.fileInput}
            aria-label="Choose database file"
          />
          {databaseFile && (
            <p className={styles.selectedFile}>
              Selected file: <strong>{databaseFile.name}</strong>
            </p>
          )}

          <div className={styles.dangerActions}>
            <Button
              variant="destructive"
              onClick={() => setIsImportModalOpen(true)}
              loading={isImporting}
              loadingLabel="Importing…"
              disabled={!databaseFile}
            >
              Import Database
            </Button>
          </div>
        </div>
      </section>

      <ConfirmationModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onConfirm={handleConfirmImport}
        title="Import database?"
        message="This will permanently replace all existing database data."
        confirmText="Import Database"
        confirmationPhrase="IMPORT"
      >
        <p className={styles.modalFileLabel}>
          Selected file: <strong>{databaseFile?.name}</strong>
        </p>
      </ConfirmationModal>
    </div>
  );
};

export default Settings;
