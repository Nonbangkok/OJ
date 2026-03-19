import { useState, useEffect, useCallback, useRef } from 'react';
import submissionService from '../services/submissionService';
import authService from '../services/authService';
import { useAutocomplete } from './useAutocomplete';
import { USER_ROLES, SUBMISSION_STATUS } from '../utils/constants';
import { POLLING_INTERVALS } from '../config/constants';

export const useSubmissions = (problemId, contestId) => {
    const [submissions, setSubmissions] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all');
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const problemAutocomplete = useAutocomplete(submissionService.searchProblems, { contestId });
    const userAutocomplete = useAutocomplete(submissionService.searchUsers, { contestId });

    const [appliedFilters, setAppliedFilters] = useState({ problemId: '', userId: '' });
    const lastRequestIdRef = useRef(0);

    // 1. Initial User Fetch
    useEffect(() => {
        const fetchUser = async () => {
            try {
                const data = await authService.checkLogin();
                if (data.isAuthenticated) setCurrentUser(data.user);
            } catch (err) {
                console.error("Error fetching user:", err);
            }
        };
        fetchUser();
    }, []);

    // 2. Data Fetching Logic
    const fetchData = useCallback(async () => {
        const currentRequestId = Date.now();
        lastRequestIdRef.current = currentRequestId;

        try {
            const params = {};
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
                setSubmissions(data);
                setError('');
            }
        } catch (err) {
            if (currentRequestId === lastRequestIdRef.current) {
                setError('Failed to fetch submissions.');
                console.error(err);
            }
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
            [SUBMISSION_STATUS.PENDING, SUBMISSION_STATUS.COMPILING, SUBMISSION_STATUS.RUNNING].includes(s.overall_status)
        );

        if (isProcessing) {
            const intervalId = setInterval(fetchData, POLLING_INTERVALS.SUBMISSIONS);
            return () => clearInterval(intervalId);
        }
    }, [submissions, fetchData]);

    // 4. Handlers
    const handleApplyFilters = () => {
        setSubmissions([]);
        setLoading(true);
        setAppliedFilters({
            problemId: problemAutocomplete.query,
            userId: userAutocomplete.query,
        });
    };

    const handleViewCode = async (submissionId) => {
        try {
            const data = await submissionService.getById(submissionId, contestId);
            setSelectedSubmission(data);
            setIsModalOpen(true);
        } catch (err) {
            setError(`Failed to fetch submission #${submissionId}.`);
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedSubmission(null);
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
        selectProblem: problemAutocomplete.select,
        selectUser: userAutocomplete.select,

        handleApplyFilters,
        handleViewCode,
        handleCloseModal,
        refresh: fetchData
    };
};
