import { useState, useEffect, useCallback, useRef } from 'react';
import submissionService from '../services/submissionService';
import {
  subscribeSubmissions,
  isRealtimeSupported,
  type SubmissionUpdatePayload,
} from '../services/realtimeService';
import { useAuth } from '../context/AuthContext';
import { useAutocomplete } from './useAutocomplete';
import { USER_ROLES, SUBMISSION_STATUS } from '../utils/constants';
import { POLLING_INTERVALS, REALTIME } from '../config/constants';
import type { SubmissionDetail, SubmissionSummary, SubmissionQueryParams, AuthUser } from '../types';

type SubmissionFilter = 'all' | 'mine';

interface AppliedFilters {
  problemId: string;
  userId: string;
}

export const useSubmissions = (
  problemId: string | number | null | undefined,
  contestId: string | number | null | undefined
) => {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  // Session user comes from AuthContext — no extra /me request per page.
  // refreshUser is pulled in for SCORE-008 (see the SSE effect below).
  const { user: currentUser, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<SubmissionFilter>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDetail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Realtime (SSE) state. While the stream is healthy, interval polling runs
  // only as a slow safety net; if the stream dies for good (auth failure,
  // server error — not a transient drop, which the browser retries), revert
  // to the original fast interval so the page never stops updating.
  const [realtimeDown, setRealtimeDown] = useState(!isRealtimeSupported());
  // Latest SSE submission event — consumed by the "+N XP" first-solve toast.
  // Server-side filtering already guarantees these are the user's own
  // submissions, so no extra owner check is needed here.
  const [lastRealtimeEvent, setLastRealtimeEvent] = useState<SubmissionUpdatePayload | null>(null);

  const problemAutocomplete = useAutocomplete(submissionService.searchProblems, { contestId });
  const userAutocomplete = useAutocomplete(submissionService.searchUsers, { contestId });

  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({ problemId: '', userId: '' });
  // Monotonic request id: two fetches started in the same millisecond must not
  // collide the way Date.now() did, or a stale response could win.
  const lastRequestIdRef = useRef(0);

  // 1. Data Fetching Logic
  const fetchData = useCallback(async () => {
    const currentRequestId = ++lastRequestIdRef.current;

    try {
      const params: SubmissionQueryParams = {};
      if (problemId) {
        params.filter = 'mine';
        params.problemId = problemId;
      } else if (filter === 'mine') {
        params.filter = 'mine';
      }

      if (contestId) params.contestId = contestId;

      // Staff/Admin search filters
      if (
        currentUser &&
        (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.STAFF) &&
        !problemId
      ) {
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

  // 2. Realtime (SSE) stream — refetch whenever one of the user's own
  //    submissions changes, so verdicts appear without waiting for a poll
  //    tick. Unauthenticated visitors never connect (the endpoint requires
  //    a session); their 401 would just trip onStreamDown.
  useEffect(() => {
    if (!currentUser || !isRealtimeSupported()) {
      return undefined;
    }
    const unsubscribe = subscribeSubmissions((payload) => {
      setLastRealtimeEvent(payload);
      void fetchData();
      // SCORE-008: a positive xp_awarded means the user's total XP just
      // changed — the navbar tier/level badge rides on the AuthContext
      // user, which was fetched at bootstrap. Refetch /me so a level-up
      // shows without a manual reload. Only on the reward event, not every
      // status transition.
      if (typeof payload.xp_awarded === 'number' && payload.xp_awarded > 0) {
        void refreshUser();
      }
    }, {
      onStreamDown: () => setRealtimeDown(true),
    });
    return unsubscribe;
  }, [currentUser, fetchData, refreshUser]);

  // 3. Polling for Pending Submissions (fallback safety net — SSE only
  //    lowers latency, polling stays the correctness floor)
  useEffect(() => {
    const processingStatuses: string[] = [
      SUBMISSION_STATUS.PENDING,
      SUBMISSION_STATUS.COMPILING,
      SUBMISSION_STATUS.RUNNING,
    ];
    const isProcessing = submissions.some((s) =>
      processingStatuses.includes(s.overall_status)
    );

    if (isProcessing) {
      const intervalMs = realtimeDown
        ? POLLING_INTERVALS.SUBMISSIONS
        : REALTIME.SUBMISSIONS_FALLBACK_POLL_MS;
      const intervalId = setInterval(fetchData, intervalMs);
      return () => clearInterval(intervalId);
    }
  }, [submissions, fetchData, realtimeDown]);

  // 4. Handlers
  const handleApplyFilters = () => {
    setSubmissions([]);
    setLoading(true);
    setAppliedFilters({
      problemId: problemAutocomplete.query,
      userId: userAutocomplete.query,
    });
  };

  const handleViewCode = async (submissionId: string | number) => {
    try {
      // Keep the original call shape: pass contestId through untouched so the
      // service default (null) applies exactly as before.
      const data = await submissionService.getById(submissionId, contestId ?? undefined);
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
    lastRealtimeEvent,

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
    refresh: fetchData,
  };
};
