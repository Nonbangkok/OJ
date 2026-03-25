import { useState, useEffect, useCallback } from 'react';
import adminService from '../../services/adminService';

const useProblemMigrationModal = (contest, onSuccess) => {
    const [availableProblems, setAvailableProblems] = useState([]);
    const [contestProblems, setContestProblems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [migrationLoading, setMigrationLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedAvailable, setSelectedAvailable] = useState([]);
    const [selectedContest, setSelectedContest] = useState([]);

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

            await adminService.migrateContestProblems(contest.id, selectedAvailable, 'move_to_contest');

            setSelectedAvailable([]);
            await fetchProblems();
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error('Error moving problems to contest:', err);
            setError(err.response?.data?.message || 'Failed to move problems to contest');
        } finally {
            setMigrationLoading(false);
        }
    };

    const handleMoveToMain = async (problemId = null) => {
        const problemIdsToRemove = problemId ? [problemId] : selectedContest;

        if (problemIdsToRemove.length === 0) {
            return;
        }

        try {
            setMigrationLoading(true);
            setError('');

            await adminService.migrateContestProblems(contest.id, problemIdsToRemove, 'move_to_main');

            setSelectedContest([]);
            await fetchProblems();
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error('Error moving problems to main:', err);
            setError(err.response?.data?.message || 'Failed to move problems to main');
        } finally {
            setMigrationLoading(false);
        }
    };

    const handleSelectAvailable = (problemId) => {
        setSelectedAvailable(prev =>
            prev.includes(problemId)
                ? prev.filter(id => id !== problemId)
                : [...prev, problemId]
        );
    };

    const handleSelectContest = (problemId) => {
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
