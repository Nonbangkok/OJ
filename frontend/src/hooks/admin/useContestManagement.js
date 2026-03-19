import { useState, useEffect, useCallback } from 'react';
import adminService from '../../services/adminService';

const useContestManagement = (styles) => {
    const [contests, setContests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingContest, setEditingContest] = useState(null);
    const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
    const [migrationContest, setMigrationContest] = useState(null);

    // Confirmation modal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [contestToDelete, setContestToDelete] = useState(null);

    const fetchContests = useCallback(async () => {
        try {
            setLoading(true);
            const data = await adminService.getContests();
            setContests(data);
        } catch (err) {
            console.error('Error fetching contests:', err);
            setError('Failed to load contests');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchContests();
    }, [fetchContests]);

    const handleDelete = async () => {
        if (contestToDelete) {
            try {
                await adminService.deleteContest(contestToDelete);
                fetchContests();
                setIsConfirmModalOpen(false);
                setContestToDelete(null);
            } catch (err) {
                console.error('Error deleting contest:', err);
                setError(err.response?.data?.message || 'Failed to delete contest');
            }
        }
    };

    const handleEdit = (contest) => {
        setEditingContest(contest);
        setIsModalOpen(true);
    };

    const handleCreate = () => {
        setEditingContest(null);
        setIsModalOpen(true);
    };

    const handleManageProblems = (contest) => {
        setMigrationContest(contest);
        setIsMigrationModalOpen(true);
    };

    const getStatusBadge = (status) => {
        if (!styles) return <span>{status}</span>;

        const statusClasses = {
            'scheduled': `${styles.badge} ${styles.scheduled}`,
            'running': `${styles.badge} ${styles.running}`,
            'finishing': `${styles.badge} ${styles.finishing}`,
            'finished': `${styles.badge} ${styles.finished}`
        };

        const statusText = {
            'scheduled': 'Scheduled',
            'running': 'Running',
            'finishing': 'Finishing',
            'finished': 'Finished'
        };

        return (
            <span className={statusClasses[status] || styles.badge}>
                {statusText[status] || status}
            </span>
        );
    };

    const formatDateTime = (dateTime) => {
        return new Date(dateTime).toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return {
        contests,
        loading,
        error,
        isModalOpen,
        setIsModalOpen,
        editingContest,
        setEditingContest,
        isMigrationModalOpen,
        setIsMigrationModalOpen,
        migrationContest,
        setMigrationContest,
        isConfirmModalOpen,
        setIsConfirmModalOpen,
        contestToDelete,
        setContestToDelete,
        fetchContests,
        handleDelete,
        handleEdit,
        handleCreate,
        handleManageProblems,
        getStatusBadge,
        formatDateTime
    };
};

export default useContestManagement;
