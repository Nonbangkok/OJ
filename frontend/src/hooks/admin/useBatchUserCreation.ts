import { useState } from 'react';
import adminService from '../../services/adminService';

interface CreatedUser {
  username: string;
  password: string;
}

const useBatchUserCreation = (_onUsersCreated: () => void) => {
    const [prefix, setPrefix] = useState('');
    const [count, setCount] = useState(10);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [createdUsers, setCreatedUsers] = useState<CreatedUser[] | null>(null);

    const generateAndDownloadCsv = () => {
        if (!createdUsers || createdUsers.length === 0) return;

        const csvHeader = 'username,password\n';
        const csvRows = createdUsers.map(user => `"${user.username}","${user.password}"`).join('\n');
        const csvContent = csvHeader + csvRows;

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        link.setAttribute('download', `${prefix || 'users'}_${timestamp}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setCreatedUsers(null);
        setIsLoading(true);

        if (count <= 0 || count > 100) {
            setError('Please enter a number between 1 and 100.');
            setIsLoading(false);
            return;
        }

        try {
            const data = await adminService.createBatchUsers({ prefix, count: Number(count) });
            setCreatedUsers(data.users as unknown as CreatedUser[]);
            // We do NOT call onUsersCreated() here to prevent the results table from disappearing.
            // The admin can manually refresh the page to see the updated main user list.
        } catch (err) {
            setError((err as any).response?.data?.message || 'Failed to create users.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return {
        prefix,
        setPrefix,
        count,
        setCount,
        isLoading,
        error,
        createdUsers,
        generateAndDownloadCsv,
        handleSubmit
    };
};

export default useBatchUserCreation;
