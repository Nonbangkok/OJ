/**
 * Realtime (SSE) client — thin wrapper around EventSource for the backend's
 * /realtime endpoints. Session cookies ride along automatically (same-origin
 * request), so no headers or auth plumbing is needed here.
 *
 * Reconnects are left to the browser's native EventSource retry; these
 * helpers only surface a "stream down for good" signal (readyState CLOSED,
 * e.g. auth failure or server error) so callers can fall back to polling.
 */

/** A submission status/score transition for one of the requesting user's own submissions. */
export interface SubmissionUpdatePayload {
  type: 'submission_update';
  submissionId: number;
  table: 'submissions' | 'contest_submissions';
  overall_status: string;
  score: number;
  user_id: number | null;
}

/** A "something changed" ping for one contest's scoreboard. */
export interface ScoreboardUpdatePayload {
  type: 'scoreboard_update';
  contestId: number;
}

/** The API base matches the shared axios instance (`/api` in the deployed stack). */
const API_BASE = process.env.REACT_APP_API_URL || '/api';

export interface RealtimeSubscribeOptions {
  /**
   * Invoked once when the stream has failed for good (readyState CLOSED).
   * Transient drops are retried by the browser and do not fire this.
   */
  onStreamDown?: () => void;
}

export const isRealtimeSupported = (): boolean =>
  typeof EventSource !== 'undefined';

type MessageListener<T> = (payload: T) => void;

const openStream = <T>(
  url: string,
  eventName: string,
  onUpdate: MessageListener<T>,
  options?: RealtimeSubscribeOptions
): (() => void) => {
  const source = new EventSource(url);

  source.addEventListener(eventName, (event: MessageEvent<string>) => {
    try {
      onUpdate(JSON.parse(event.data) as T);
    } catch {
      // Malformed payload — drop it; polling remains the correctness net.
    }
  });

  source.onerror = () => {
    // CLOSED means the browser gave up (auth failure, server error) — native
    // retry is over. CONNECTING means it is still retrying on its own.
    if (source.readyState === EventSource.CLOSED) {
      options?.onStreamDown?.();
    }
  };

  return () => source.close();
};

/**
 * Subscribe to the signed-in user's own submission status transitions.
 * Returns an unsubscribe function.
 */
export const subscribeSubmissions = (
  onUpdate: MessageListener<SubmissionUpdatePayload>,
  options?: RealtimeSubscribeOptions
): (() => void) => {
  if (!isRealtimeSupported()) {
    options?.onStreamDown?.();
    return () => undefined;
  }
  return openStream<SubmissionUpdatePayload>(
    `${API_BASE}/realtime/submissions`,
    'submission_update',
    onUpdate,
    options
  );
};

/**
 * Subscribe to scoreboard pings for one contest. Returns an unsubscribe
 * function.
 */
export const subscribeScoreboard = (
  contestId: string | number,
  onUpdate: MessageListener<ScoreboardUpdatePayload>,
  options?: RealtimeSubscribeOptions
): (() => void) => {
  if (!isRealtimeSupported()) {
    options?.onStreamDown?.();
    return () => undefined;
  }
  return openStream<ScoreboardUpdatePayload>(
    `${API_BASE}/realtime/contests/${encodeURIComponent(String(contestId))}`,
    'scoreboard_update',
    onUpdate,
    options
  );
};
