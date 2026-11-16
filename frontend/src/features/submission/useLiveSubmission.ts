import { useEffect, useState } from 'react';
import { POLLING_INTERVALS, REALTIME } from '../../config/constants';
import submissionService from '../../services/submissionService';
import { subscribeSubmissions } from '../../services/realtimeService';
import type { SubmissionDetail } from '../../types';

const PENDING = new Set(['Pending', 'Compiling', 'Running']);

/**
 * One submission kept current: fetched once, re-fetched when the SSE stream
 * reports this submission, and polled while it is still judging (fast while
 * the stream is down, a slow safety net while it is up). Polling stops at a
 * final verdict.
 */
export default function useLiveSubmission(
  id: number | null,
  contestId?: string,
): { submission: SubmissionDetail | null; error: string | null } {
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamDown, setStreamDown] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  // Reset when the tracked submission changes (adjust state during render).
  const [trackedId, setTrackedId] = useState(id);
  if (trackedId !== id) {
    setTrackedId(id);
    setSubmission(null);
    setError(null);
  }

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    submissionService.getById(id, contestId ?? null)
      .then((data) => { if (!cancelled) { setSubmission(data); setError(null); } })
      .catch(() => { if (!cancelled) setError("Couldn't load this submission."); });
    return () => { cancelled = true; };
  }, [id, contestId, refreshTick]);

  useEffect(() => {
    if (id === null) return undefined;
    return subscribeSubmissions(
      (payload) => { if (payload.submissionId === id) setRefreshTick((t) => t + 1); },
      { onStreamDown: () => setStreamDown(true) },
    );
  }, [id]);

  const judging = submission !== null && PENDING.has(submission.overall_status);
  useEffect(() => {
    if (!judging) return undefined;
    const interval = streamDown ? POLLING_INTERVALS.SUBMISSIONS : REALTIME.SUBMISSIONS_FALLBACK_POLL_MS;
    const timer = window.setInterval(() => setRefreshTick((t) => t + 1), interval);
    return () => window.clearInterval(timer);
  }, [judging, streamDown]);

  return id === null ? { submission: null, error: null } : { submission, error };
}
