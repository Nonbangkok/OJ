import { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import submissionService from '../services/submissionService';
import authService from '../services/authService';
import { useAutocomplete } from './useAutocomplete';
import { USER_ROLES, SUBMISSION_STATUS } from '../utils/constants';
import { POLLING_INTERVALS } from '../config/constants';
import type { Submission, User, Problem } from '../types';

interface UseSubmissionsReturn {
    submissions: (Submission & { problem_title?: string; problem_name?: string })[];
    currentUser: User | null;
    loading: boolean;
    error: string;
    filter: 'all' | 'mine';
    setFilter: (filter: 'all' | 'mine') => void;
    selectedSubmission: Submission | null;
    isModalOpen: boolean;
    filterProblemId: string;
    setFilterProblemId: (query: string) => void;
    filterUserId: string;
    setFilterUserId: (query: string) => void;
    problemSuggestions: Problem[];
    userSuggestions: User[];
    showProblemSuggestions: boolean;
    setShowProblemSuggestions: (show: boolean) => void;
    showUserSuggestions: boolean;
    setShowUserSuggestions: (show: boolean) => void;
    handleProblemChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
    handleUserChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
    selectProblem: (value: string | number) => void;
    selectUser: (value: string) => void;
    handleApplyFilters: () => void;
    handleViewCode: (submissionId: string | number) => Promise<void>;
    handleCloseModal: () => void;
    refresh: () => Promise<void>;
}

export const useSubmissions = (problemId?: string | number, contestId?: string | number): UseSubmissionsReturn => {
    const [submissions, setSubmissions] = useState<(Submission & { problem_title?: string; problem_name?: string })[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [filter, setFilter] = useState<'all' | 'mine'>('all');
    const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

    const problemAutocomplete = useAutocomplete<Problem>(submissionService.searchProblems, { contestId });
    const userAutocomplete = useAutocomplete<User>(submissionService.searchUsers, { contestId });

    const [appliedFilters, setAppliedFilters] = useState<{ problemId: string; userId: string }>({ problemId: '', userId: '' });
    const lastRequestIdRef = useRef<number>(0);

    // 1. Initial User Fetch
    useEffect(() => {
        const fetchUser = async () => {
            try {
                const data = await authService.checkLogin();
                if (data.isAuthenticated && data.user) setCurrentUser(data.user);
            } catch (err) {
                console.error("Error fetching user:", err);
            }
        };
        fetchUser();
    }, []);

    // 2. Data Fetching Logic
    const fetchData = useCallback(async (): Promise<void> => {
        const currentRequestId = Date.now();
        lastRequestIdRef.current = currentRequestId;

        try {
            const params: any = {};
            if (problemId) {
                params.filter = 'mine';
                params.problemId = problemId;
            } else if (filter === 'mine') {
                params.filter = 'mine';
            }

            if (contestId) params.contestId = contestId;

            // Staff/Admin search filters
            if (currentUser && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.STAFF) && !problemId) {
                if (appliedFilters.problemId) params.filterProblemId = appliedFilters.problemId;
                if (appliedFilters.userId) params.filterUserId = appliedFilters.userId;
            }

            const data = await submissionService.getAll(params);

            if (currentRequestId === lastRequestIdRef.current) {
                setSubmissions(data as any);
                setError('');
            }
            return;
        } catch (err) {
            if (currentRequestId === lastRequestIdRef.current) {
                setError('Failed to fetch submissions.');
                console.error(err);
            }
            return;
        } finally {
            if (currentRequestId === lastRequestIdRef.current) {
                setLoading(false);
            }
        }
    }, [problemId, filter, contestId, currentUser, appliedFilters]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // 3. Polling for Pending Submissions
    useEffect(() => {
        const isProcessing = submissions.some(s =>
            [SUBMISSION_STATUS.PENDING, SUBMISSION_STATUS.COMPILING, SUBMISSION_STATUS.RUNNING].includes(s.status || '')
        );

        if (isProcessing) {
            const intervalId = setInterval(fetchData, POLLING_INTERVALS.SUBMISSIONS);
            return () => clearInterval(intervalId);
        }
        return undefined;
    }, [submissions, fetchData]);

    // 4. Handlers
    const handleApplyFilters = (): void => {
        setSubmissions([]);
        setLoading(true);
        setAppliedFilters({
            problemId: problemAutocomplete.query,
            userId: userAutocomplete.query,
        });
    };

    const handleViewCode = async (submissionId: string | number): Promise<void> => {
        try {
            const data = await submissionService.getById(submissionId, contestId);
            setSelectedSubmission(data);
            setIsModalOpen(true);
        } catch (err) {
            setError(`Failed to fetch submission #${submissionId}.`);
        }
    };

    const handleCloseModal = (): void => {
        setIsModalOpen(false);
        setSelectedSubmission(null);
    };

    const selectProblem = (value: string | number): void => {
        problemAutocomplete.setQuery(String(value));
        problemAutocomplete.setShowSuggestions(false);
    };

    const selectUser = (value: string): void => {
        userAutocomplete.setQuery(value);
        userAutocomplete.setShowSuggestions(false);
    };

    return {
        submissions,
        currentUser,
        loading,
        error,
        filter,
        setFilter,
        selectedSubmission,
        isModalOpen,

        // Autocomplete — expose with backward-compatible names
        filterProblemId: problemAutocomplete.query,
        setFilterProblemId: problemAutocomplete.setQuery,
        filterUserId: userAutocomplete.query,
        setFilterUserId: userAutocomplete.setQuery,
        problemSuggestions: problemAutocomplete.suggestions,
        userSuggestions: userAutocomplete.suggestions,
        showProblemSuggestions: problemAutocomplete.showSuggestions,
        setShowProblemSuggestions: problemAutocomplete.setShowSuggestions,
        showUserSuggestions: userAutocomplete.showSuggestions,
        setShowUserSuggestions: userAutocomplete.setShowSuggestions,
        handleProblemChange: problemAutocomplete.handleChange,
        handleUserChange: userAutocomplete.handleChange,
        selectProblem,
        selectUser,

        handleApplyFilters,
        handleViewCode,
        handleCloseModal,
        refresh: fetchData
    };
};
