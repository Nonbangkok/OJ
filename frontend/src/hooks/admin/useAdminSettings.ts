import { useState, useEffect } from 'react';
import adminService from '../../services/adminService';
import { useSettings } from '../../context/SettingsContext';
import { APP_CONSTANTS } from '../../utils/constants';

const useAdminSettings = () => {
    const [isRegistrationEnabled, setIsRegistrationEnabled] = useState(true);
    const [isLoadingRegistration, setIsLoadingRegistration] = useState(true);
    const [registrationError, setRegistrationError] = useState('');
    const [registrationSuccess, setRegistrationSuccess] = useState('');

    // Use context for refreshing global settings
    const { refreshSettings } = useSettings();

    const [databaseFile, setDatabaseFile] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [databaseError, setDatabaseError] = useState('');
    const [databaseSuccess, setDatabaseSuccess] = useState('');

    useEffect(() => {
        const fetchRegistrationSettings = async () => {
            try {
                const data = await adminService.getRegistrationSettings();
                setIsRegistrationEnabled(data.enabled);
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
            await adminService.updateRegistrationSettings(newStatus);
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
            setTimeout(() => setDatabaseSuccess(''), 3000);
        } catch (err) {
            console.error('Export error:', err);
            setDatabaseError('Failed to export database.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleFileChange = (event) => {
        const selectedFile = event.target.files[0] || null;
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

        if (!window.confirm("WARNING: Importing a database will PERMANENTLY DELETE all existing data and replace it with the content of the uploaded file. Are you absolutely sure you want to proceed? This action cannot be undone.")) {
            return;
        }

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

            const pollImportProgress = async () => {
                const progress = await adminService.getImportDatabaseProgress(jobId, token);

                if (progress.status === 'completed') {
                    setDatabaseSuccess(progress.message || 'Database imported successfully! You may need to refresh or re-login.');
                    setDatabaseFile(null);
                    setIsImporting(false);
                    setTimeout(() => setDatabaseSuccess(''), 5000);
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
                }, 3000);
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
    };
};

export default useAdminSettings;
