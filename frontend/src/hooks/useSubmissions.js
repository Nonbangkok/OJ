import { useState, useEffect, useCallback, useRef } from 'react';
import submissionService from '../services/submissionService';
import authService from '../services/authService';

export const useSubmissions = (problemId, contestId) => {
    const [submissions, setSubmissions] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all'); // 'all' or 'mine'
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Input states (Autocomplete)
    const [filterProblemId, setFilterProblemId] = useState('');
    const [filterUserId, setFilterUserId] = useState('');
    const [appliedFilters, setAppliedFilters] = useState({ problemId: '', userId: '' });
    const [problemSuggestions, setProblemSuggestions] = useState([]);
    const [userSuggestions, setUserSuggestions] = useState([]);
    const [showProblemSuggestions, setShowProblemSuggestions] = useState(false);
    const [showUserSuggestions, setShowUserSuggestions] = useState(false);

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
            if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff') && !problemId) {
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
            ['Pending', 'Compiling', 'Running'].includes(s.overall_status)
        );

        if (isProcessing) {
            const intervalId = setInterval(fetchData, 2500);
            return () => clearInterval(intervalId);
        }
    }, [submissions, fetchData]);

    // 4. Handlers
    const handleApplyFilters = () => {
        setSubmissions([]);
        setLoading(true);
        setAppliedFilters({ problemId: filterProblemId, userId: filterUserId });
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

    // Autocomplete helpers
    const handleProblemChange = async (e) => {
        const value = e.target.value;
        setFilterProblemId(value);
        if (value.length > 0) {
            try {
                const data = await submissionService.searchProblems(value);
                setProblemSuggestions(data);
                setShowProblemSuggestions(true);
            } catch (err) { console.error(err); }
        } else {
            setShowProblemSuggestions(false);
        }
    };

    const handleUserChange = async (e) => {
        const value = e.target.value;
        setFilterUserId(value);
        if (value.length > 0) {
            try {
                const data = await submissionService.searchUsers(value);
                setUserSuggestions(data);
                setShowUserSuggestions(true);
            } catch (err) { console.error(err); }
        } else {
            setShowUserSuggestions(false);
        }
    };

    const selectProblem = (id) => {
        setFilterProblemId(id);
        setShowProblemSuggestions(false);
    };

    const selectUser = (username) => {
        setFilterUserId(username);
        setShowUserSuggestions(false);
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
        filterProblemId,
        setFilterProblemId,
        filterUserId,
        setFilterUserId,
        problemSuggestions,
        userSuggestions,
        showProblemSuggestions,
        setShowProblemSuggestions,
        showUserSuggestions,
        setShowUserSuggestions,
        handleApplyFilters,
        handleViewCode,
        handleCloseModal,
        handleProblemChange,
        handleUserChange,
        selectProblem,
        selectUser,
        refresh: fetchData
    };
};
