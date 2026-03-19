import React, { useState, useEffect, useCallback } from 'react';
import adminService from '../../services/adminService';
import type { Contest } from '../../types';

interface UseContestManagementReturn {
    contests: Contest[];
    loading: boolean;
    error: string;
    isModalOpen: boolean;
    setIsModalOpen: (isOpen: boolean) => void;
    editingContest: Contest | null;
    setEditingContest: (contest: Contest | null) => void;
    isMigrationModalOpen: boolean;
    setIsMigrationModalOpen: (isOpen: boolean) => void;
    migrationContest: Contest | null;
    setMigrationContest: (contest: Contest | null) => void;
    isConfirmModalOpen: boolean;
    setIsConfirmModalOpen: (isOpen: boolean) => void;
    contestToDelete: string | number | null;
    setContestToDelete: (id: string | number | null) => void;
    fetchContests: () => Promise<void>;
    handleDelete: () => Promise<void>;
    handleEdit: (contest: Contest) => void;
    handleCreate: () => void;
    handleManageProblems: (contest: Contest) => void;
    getStatusBadge: (status: string) => React.ReactNode;
    formatDateTime: (dateTime: string) => string;
}

const useContestManagement = (styles: { [key: string]: string }): UseContestManagementReturn => {
    const [contests, setContests] = useState<Contest[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');

    // Modal states
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editingContest, setEditingContest] = useState<Contest | null>(null);
    const [isMigrationModalOpen, setIsMigrationModalOpen] = useState<boolean>(false);
    const [migrationContest, setMigrationContest] = useState<Contest | null>(null);

    // Confirmation modal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
    const [contestToDelete, setContestToDelete] = useState<string | number | null>(null);

    const fetchContests = useCallback(async (): Promise<void> => {
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

    const handleDelete = async (): Promise<void> => {
        if (contestToDelete) {
            try {
                await adminService.deleteContest(contestToDelete);
                fetchContests();
                setIsConfirmModalOpen(false);
                setContestToDelete(null);
            } catch (err: any) {
                console.error('Error deleting contest:', err);
                setError(err.response?.data?.message || 'Failed to delete contest');
            }
        }
    };

    const handleEdit = (contest: Contest): void => {
        setEditingContest(contest);
        setIsModalOpen(true);
    };

    const handleCreate = (): void => {
        setEditingContest(null);
        setIsModalOpen(true);
    };

    const handleManageProblems = (contest: Contest): void => {
        setMigrationContest(contest);
        setIsMigrationModalOpen(true);
    };

    const getStatusBadge = (status: string): React.ReactNode => {
        if (!styles) return React.createElement('span', null, status);

        const statusClasses: Record<string, string> = {
            'scheduled': `${styles.badge} ${styles.scheduled}`,
            'running': `${styles.badge} ${styles.running}`,
            'finishing': `${styles.badge} ${styles.finishing}`,
            'finished': `${styles.badge} ${styles.finished}`
        };

        const statusText: Record<string, string> = {
            'scheduled': 'Scheduled',
            'running': 'Running',
            'finishing': 'Finishing',
            'finished': 'Finished'
        };

        return React.createElement('span', { className: statusClasses[status] || styles.badge }, statusText[status] || status);
    };

    const formatDateTime = (dateTime: string): string => {
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
