import { useState, useEffect } from 'react';
import adminService from '../../services/adminService';
import { useSettings } from '../../context/SettingsContext';

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
        setDatabaseFile(event.target.files[0]);
        setDatabaseError('');
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
            await adminService.importDatabase(formData);
            setDatabaseSuccess('Database imported successfully! You may need to refresh or re-login.');
            setDatabaseFile(null);
            setTimeout(() => setDatabaseSuccess(''), 5000);
        } catch (err) {
            console.error('Import error:', err);
            setDatabaseError(`Failed to import database: ${err.response?.data?.message || err.message}`);
        } finally {
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
