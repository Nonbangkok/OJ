import { useState, useEffect, useCallback } from 'react';
import adminService from '../../services/adminService';
import type { Contest, Problem } from '../../types';

const useProblemMigrationModal = (contest: Contest, onSuccess: () => void) => {
    const [availableProblems, setAvailableProblems] = useState<Problem[]>([]);
    const [contestProblems, setContestProblems] = useState<Problem[]>([]);
    const [loading, setLoading] = useState(true);
    const [migrationLoading, setMigrationLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedAvailable, setSelectedAvailable] = useState<(string | number)[]>([]);
    const [selectedContest, setSelectedContest] = useState<(string | number)[]>([]);

    const fetchProblems = useCallback(async () => {
        try {
            setLoading(true);

            const [availableData, contestData] = await Promise.all([
                adminService.getAvailableProblems(),
                adminService.getContestProblemsAdmin(contest.id)
            ]);

            setAvailableProblems(availableData);
            setContestProblems(contestData);
        } catch (err) {
            console.error('Error fetching problems:', err);
            setError('Failed to load problems');
        } finally {
            setLoading(false);
        }
    }, [contest.id]);

    useEffect(() => {
        fetchProblems();
    }, [fetchProblems]);

    const handleMoveToContest = async () => {
        if (selectedAvailable.length === 0) return;

        try {
            setMigrationLoading(true);
            setError('');

            await adminService.migrateContestProblems(contest.id, selectedAvailable.map(String), 'add');

            setSelectedAvailable([]);
            await fetchProblems();
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error('Error moving problems to contest:', err);
            setError((err as any).response?.data?.message || 'Failed to move problems to contest');
        } finally {
            setMigrationLoading(false);
        }
    };

    const handleMoveToMain = async (problemId?: string | number) => {
        const problemIdsToRemove = problemId ? [problemId] : selectedContest;

        if (problemIdsToRemove.length === 0) {
            return;
        }

        try {
            setMigrationLoading(true);
            setError('');

            await adminService.migrateContestProblems(contest.id, problemIdsToRemove.map(String), 'remove');

            setSelectedContest([]);
            await fetchProblems();
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error('Error moving problems to main:', err);
            setError((err as any).response?.data?.message || 'Failed to move problems to main');
        } finally {
            setMigrationLoading(false);
        }
    };

    const handleSelectAvailable = (problemId: string | number) => {
        setSelectedAvailable(prev =>
            prev.includes(problemId)
                ? prev.filter(id => id !== problemId)
                : [...prev, problemId]
        );
    };

    const handleSelectContest = (problemId: string | number) => {
        setSelectedContest(prev =>
            prev.includes(problemId)
                ? prev.filter(id => id !== problemId)
                : [...prev, problemId]
        );
    };

    const handleSelectAllAvailable = () => {
        if (selectedAvailable.length === availableProblems.length) {
            setSelectedAvailable([]);
        } else {
            setSelectedAvailable(availableProblems.map(p => p.id));
        }
    };

    const handleSelectAllContest = () => {
        if (selectedContest.length === contestProblems.length) {
            setSelectedContest([]);
        } else {
            setSelectedContest(contestProblems.map(p => p.id));
        }
    };

    return {
        availableProblems,
        contestProblems,
        loading,
        migrationLoading,
        error,
        selectedAvailable,
        selectedContest,
        handleMoveToContest,
        handleMoveToMain,
        handleSelectAvailable,
        handleSelectContest,
        handleSelectAllAvailable,
        handleSelectAllContest
    };
};

export default useProblemMigrationModal;
