import { useState, useEffect } from 'react';
import adminService from '../../services/adminService';
import { useSettings } from '../../context/SettingsContext';
import { APP_CONSTANTS } from '../../utils/constants';
import { IMPORT_PROGRESS_POLLING, UI_TIMEOUTS } from '../../config/constants';

const useAdminSettings = () => {
    const [isRegistrationEnabled, setIsRegistrationEnabled] = useState(true);
    const [isLoadingRegistration, setIsLoadingRegistration] = useState(true);
    // Each control stays disabled until its real value has loaded: toggling a placeholder default would send the wrong value.
    const [loaded, setLoaded] = useState({ registration: false, passwordChange: false, accessMode: false });
    const [registrationError, setRegistrationError] = useState('');
    const [registrationSuccess, setRegistrationSuccess] = useState('');

    const [isPasswordChangeEnabled, setIsPasswordChangeEnabled] = useState(true);
    const [passwordChangeError, setPasswordChangeError] = useState('');
    const [passwordChangeSuccess, setPasswordChangeSuccess] = useState('');

    const [siteAccessMode, setSiteAccessMode] = useState<'public' | 'private'>('public');
    const [isSavingAccessMode, setIsSavingAccessMode] = useState(false);
    const [accessModeError, setAccessModeError] = useState('');
    const [accessModeSuccess, setAccessModeSuccess] = useState('');

    // Use context for refreshing global settings
    const { refreshSettings } = useSettings();

    const [databaseFile, setDatabaseFile] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [databaseError, setDatabaseError] = useState('');
    // Export runs from the Data row, so its failure is shown there (databaseError lives in the replace dialog).
    const [exportError, setExportError] = useState('');
    const [databaseSuccess, setDatabaseSuccess] = useState('');

    useEffect(() => {
        const fetchRegistrationSettings = async () => {
            try {
                const data = await adminService.getRegistrationSettings();
                setIsRegistrationEnabled(data.enabled);
                setLoaded(previous => ({ ...previous, registration: true }));
            } catch (err) {
                setRegistrationError('Failed to fetch registration settings.');
            } finally {
                setIsLoadingRegistration(false);
            }
        };
        fetchRegistrationSettings();

        const fetchSiteAccessMode = async () => {
            try {
                const data = await adminService.getSiteAccessMode();
                setSiteAccessMode(data.accessMode);
                setLoaded(previous => ({ ...previous, accessMode: true }));
            } catch (err) {
                setAccessModeError('Failed to fetch site access mode.');
            }
        };
        fetchSiteAccessMode();

        const fetchPasswordChangeSettings = async () => {
            try {
                const data = await adminService.getPasswordChangeSettings();
                setIsPasswordChangeEnabled(data.enabled);
                setLoaded(previous => ({ ...previous, passwordChange: true }));
            } catch (err) {
                setPasswordChangeError('Failed to fetch password change settings.');
            }
        };
        fetchPasswordChangeSettings();
    }, []);

    const handleRegistrationToggle = async () => {
        setRegistrationError('');
        setRegistrationSuccess('');
        const newStatus = !isRegistrationEnabled;
        try {
            await adminService.updateRegistrationSettings(newStatus);
            setIsRegistrationEnabled(newStatus);
            setRegistrationSuccess(`Registration has been ${newStatus ? 'enabled' : 'disabled'}.`);
            await refreshSettings();
            setTimeout(() => setRegistrationSuccess(''), UI_TIMEOUTS.SUCCESS_MESSAGE_SHORT);
        } catch (err) {
            setRegistrationError('Failed to update registration settings.');
        }
    };

    const handlePasswordChangeToggle = async () => {
        setPasswordChangeError('');
        setPasswordChangeSuccess('');
        const newStatus = !isPasswordChangeEnabled;
        try {
            await adminService.updatePasswordChangeSettings(newStatus);
            setIsPasswordChangeEnabled(newStatus);
            setPasswordChangeSuccess(`Password changes have been ${newStatus ? 'enabled' : 'disabled'}.`);
            await refreshSettings();
            setTimeout(() => setPasswordChangeSuccess(''), UI_TIMEOUTS.SUCCESS_MESSAGE_SHORT);
        } catch (err) {
            setPasswordChangeError('Failed to update password change settings.');
        }
    };

    const handleSiteAccessModeChange = async (mode: 'public' | 'private') => {
        setAccessModeError('');
        setAccessModeSuccess('');
        setIsSavingAccessMode(true);
        try {
            await adminService.updateSiteAccessMode(mode);
            setSiteAccessMode(mode);
            setAccessModeSuccess(`Site access mode set to ${mode}.`);
            // Propagate to the app-wide context so the navbar / routes react
            // immediately without a reload.
            await refreshSettings();
            setTimeout(() => setAccessModeSuccess(''), UI_TIMEOUTS.SUCCESS_MESSAGE_SHORT);
        } catch (err) {
            setAccessModeError('Failed to update site access mode.');
        } finally {
            setIsSavingAccessMode(false);
        }
    };

    const handleExportDatabase = async () => {
        setIsExporting(true);
        setExportError('');
        setDatabaseSuccess('');
        try {
            const response = await adminService.exportDatabase();

            const blob = new Blob([response.data], { type: 'application/sql' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `oj_backup_${Date.now()}.sql`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);

            setDatabaseSuccess('Database exported successfully!');
            setTimeout(() => setDatabaseSuccess(''), UI_TIMEOUTS.SUCCESS_MESSAGE_SHORT);
        } catch (err) {
            console.error('Export error:', err);
            setExportError('Failed to export database.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleFileChange = (event) => selectDatabaseFile(event.target.files[0] || null);

    /** FileDrop hands over a File directly. */
    const selectDatabaseFile = (selectedFile) => {
        setDatabaseFile(selectedFile);
        setDatabaseError('');

        if (selectedFile && selectedFile.size > APP_CONSTANTS.LARGE_UPLOAD_WARNING_BYTES && !process.env.REACT_APP_LARGE_UPLOAD_API_URL) {
            setDatabaseError('Large uploads over 100MB will usually fail through proxied Cloudflare. Set REACT_APP_LARGE_UPLOAD_API_URL to a DNS-only/origin upload endpoint before importing this file.');
        }
    };

    const handleImportDatabase = async () => {
        if (!databaseFile) {
            setDatabaseError('Please select a database dump file to import.');
            return;
        }

        const allowedTypes = ['.sql', '.dump', '.tar'];
        const fileExtension = `.${databaseFile.name.split('.').pop().toLowerCase()}`;
        if (!allowedTypes.includes(fileExtension)) {
            setDatabaseError('Unsupported file type. Only .sql, .dump, or .tar files are allowed.');
            return;
        }

        // The destructive-confirmation step lives in the UI layer
        // (ConfirmationModal with type-to-confirm) — by the time this runs,
        // the user has already confirmed the import.
        setIsImporting(true);
        setDatabaseError('');
        setDatabaseSuccess('');

        const formData = new FormData();
        formData.append('databaseDump', databaseFile);

        try {
            const response = await adminService.importDatabase(formData);

            if (!response.jobId || !response.token) {
                throw new Error('Database import job did not return a job ID.');
            }

            const { jobId, token } = response;

            setDatabaseSuccess('Database file uploaded. Import is running in the background...');

            // A2-07: a failed poll must never leave the dialog spinning. Retry
            // transient failures with a growing delay, then give up and say so.
            let consecutiveFailures = 0;
            const stopPollingWithError = (message: string) => {
                setDatabaseSuccess('');
                setDatabaseError(message);
                setIsImporting(false);
            };

            const pollImportProgress = async () => {
                let progress;
                try {
                    progress = await adminService.getImportDatabaseProgress(jobId, token);
                } catch (err) {
                    const status = err?.response?.status;
                    if (status === 404 || status === 401) {
                        stopPollingWithError('Import status is no longer available (the server may have restarted). Check the database before importing again.');
                        return;
                    }
                    consecutiveFailures += 1;
                    if (consecutiveFailures >= IMPORT_PROGRESS_POLLING.MAX_CONSECUTIVE_FAILURES) {
                        stopPollingWithError('Lost contact with the server while the import was running. Check the database before importing again.');
                        return;
                    }
                    setDatabaseSuccess('Could not reach the server to check the import. Retrying...');
                    window.setTimeout(() => {
                        void pollImportProgress();
                    }, IMPORT_PROGRESS_POLLING.INTERVAL_MS * (consecutiveFailures + 1));
                    return;
                }
                consecutiveFailures = 0;

                if (progress.status === 'completed') {
                    setDatabaseSuccess(progress.message || 'Database imported successfully! You may need to refresh or re-login.');
                    setDatabaseFile(null);
                    setIsImporting(false);
                    setTimeout(() => setDatabaseSuccess(''), UI_TIMEOUTS.SUCCESS_MESSAGE_LONG);
                    return;
                }

                if (progress.status === 'failed') {
                    setDatabaseError(progress.message || 'Database import failed.');
                    setIsImporting(false);
                    return;
                }

                setDatabaseSuccess(progress.message || 'Database import is still running...');
                window.setTimeout(() => {
                    void pollImportProgress();
                }, IMPORT_PROGRESS_POLLING.INTERVAL_MS);
            };

            void pollImportProgress();
        } catch (err) {
            console.error('Import error:', err);
            setDatabaseError(`Failed to import database: ${err.response?.data?.message || err.message}`);
            setIsImporting(false);
        }
    };

    return {
        isRegistrationEnabled,
        isLoadingRegistration,
        loaded,
        registrationError,
        registrationSuccess,
        isPasswordChangeEnabled,
        passwordChangeError,
        passwordChangeSuccess,
        handlePasswordChangeToggle,
        databaseFile,
        isExporting,
        isImporting,
        databaseError,
        exportError,
        databaseSuccess,
        handleRegistrationToggle,
        siteAccessMode,
        isSavingAccessMode,
        accessModeError,
        accessModeSuccess,
        handleSiteAccessModeChange,
        handleExportDatabase,
        handleFileChange,
        selectDatabaseFile,
        handleImportDatabase
    };
};

export default useAdminSettings;
