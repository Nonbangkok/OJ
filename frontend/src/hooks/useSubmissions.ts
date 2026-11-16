import { useState, useEffect, useCallback, useRef } from 'react';
import submissionService from '../services/submissionService';
import {
  subscribeSubmissions,
  isRealtimeSupported,
  type SubmissionUpdatePayload,
} from '../services/realtimeService';
import { useAuth } from '../context/AuthContext';
import { useUrlFilters } from './useUrlFilters';
import { USER_ROLES, SUBMISSION_STATUS } from '../utils/constants';
import { POLLING_INTERVALS, REALTIME } from '../config/constants';
import type { SubmissionSummary, SubmissionQueryParams } from '../types';

export type SubmissionFilter = 'all' | 'mine';
const FILTER_KEYS = ['filter', 'problem', 'verdict', 'user'] as const;

/**
 * The submissions feed. Filters live in the URL (`filter`, `problem`,
 * `verdict`, `user` for staff); inside a problem page the feed is fixed to
 * the viewer's own submissions for that problem. Updates arrive over SSE,
 * with polling as the floor while anything is still judging.
 */
export const useSubmissions = (
  problemId: string | number | null | undefined,
  contestId: string | number | null | undefined
) => {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const { user: currentUser, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { values, set, setMany } = useUrlFilters(FILTER_KEYS);
  const isStaff = currentUser?.role === USER_ROLES.ADMIN || currentUser?.role === USER_ROLES.STAFF;
  // Every feed — main or contest, any role — starts on everyone's submissions; Mine is one click away.
  const defaultFilter: SubmissionFilter = 'all';
  const filter: SubmissionFilter = values.filter === 'all' || values.filter === 'mine'
    ? values.filter
    : defaultFilter;

  // While the stream is healthy, polling is a slow safety net; once it fails
  // for good, revert to the fast interval so the page never stops updating.
  const [realtimeDown, setRealtimeDown] = useState(!isRealtimeSupported());
  // Latest SSE event — consumed by the "+N XP" first-solve toast.
  const [lastRealtimeEvent, setLastRealtimeEvent] = useState<SubmissionUpdatePayload | null>(null);

  // Monotonic request id so a stale response never wins.
  const lastRequestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const currentRequestId = ++lastRequestIdRef.current;
    try {
      const params: SubmissionQueryParams = {};
      if (problemId) {
        params.filter = 'mine';
        params.problemId = problemId;
      } else {
        params.filter = filter;
        if (values.problem) params.filterProblemId = values.problem;
        if (isStaff && values.user) params.filterUserId = values.user;
      }
      if (values.verdict) params.verdict = values.verdict;
      if (contestId) params.contestId = contestId;
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
  }, [problemId, filter, contestId, isStaff, values.problem, values.user, values.verdict]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deps-keyed list fetch; fetchData only sets state after its await resolves
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!currentUser || !isRealtimeSupported()) {
      return undefined;
    }
    return subscribeSubmissions((payload) => {
      setLastRealtimeEvent(payload);
      void fetchData();
      // A positive xp_awarded changed the user's total XP: refresh /me so
      // the sidebar level updates without a reload (SCORE-008).
      if (typeof payload.xp_awarded === 'number' && payload.xp_awarded > 0) {
        void refreshUser();
      }
    }, {
      onStreamDown: () => setRealtimeDown(true),
    });
  }, [currentUser, fetchData, refreshUser]);

  useEffect(() => {
    const processingStatuses: string[] = [
      SUBMISSION_STATUS.PENDING,
      SUBMISSION_STATUS.COMPILING,
      SUBMISSION_STATUS.RUNNING,
    ];
    if (!submissions.some((s) => processingStatuses.includes(s.overall_status))) return undefined;
    const intervalMs = realtimeDown ? POLLING_INTERVALS.SUBMISSIONS : REALTIME.SUBMISSIONS_FALLBACK_POLL_MS;
    const intervalId = setInterval(fetchData, intervalMs);
    return () => clearInterval(intervalId);
  }, [submissions, fetchData, realtimeDown]);

  return {
    submissions,
    currentUser,
    isStaff,
    loading,
    error,
    filter,
    setFilter: (next: SubmissionFilter) => set('filter', next),
    filters: values,
    setFilterValue: set,
    setFilterValues: setMany,
    lastRealtimeEvent,
    refresh: fetchData,
  };
};
