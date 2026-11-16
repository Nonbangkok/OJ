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
  /** XP granted when this Accepted verdict created a NEW first-solve reward. */
  xp_awarded?: number;
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

interface SharedStream {
  source: EventSource;
  /** Listeners per SSE event name; the native listener is added once per name. */
  listeners: Map<string, Set<(payload: unknown) => void>>;
  onDown: Set<() => void>;
  refs: number;
}

/**
 * One EventSource per URL, shared by every subscriber in the tab. Browsers
 * allow ~6 HTTP/1.1 connections per origin; a stream per component (shell +
 * page + scoreboard) would exhaust them with a few contest tabs open.
 */
const streams = new Map<string, SharedStream>();

const openStream = <T>(
  url: string,
  eventName: string,
  onUpdate: MessageListener<T>,
  options?: RealtimeSubscribeOptions
): (() => void) => {
  let stream = streams.get(url);
  // Never reuse a stream the browser has given up on (or one from a replaced
  // EventSource implementation): open a fresh one instead.
  if (stream && (stream.source.readyState === EventSource.CLOSED || !(stream.source instanceof EventSource))) {
    streams.delete(url);
    stream = undefined;
  }
  if (!stream) {
    const source = new EventSource(url);
    const created: SharedStream = { source, listeners: new Map(), onDown: new Set(), refs: 0 };
    source.onerror = () => {
      // CLOSED means the browser gave up (auth failure, server error) — native
      // retry is over. CONNECTING means it is still retrying on its own.
      if (source.readyState === EventSource.CLOSED) {
        created.onDown.forEach((notify) => notify());
      }
    };
    streams.set(url, created);
    stream = created;
  }
  const shared = stream;

  let forEvent = shared.listeners.get(eventName);
  if (!forEvent) {
    const set = new Set<(payload: unknown) => void>();
    shared.listeners.set(eventName, set);
    shared.source.addEventListener(eventName, (event: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return; // Malformed payload — drop it; polling remains the correctness net.
      }
      set.forEach((listener) => listener(payload));
    });
    forEvent = set;
  }
  const listener = onUpdate as (payload: unknown) => void;
  forEvent.add(listener);
  const onDown = options?.onStreamDown;
  if (onDown) shared.onDown.add(onDown);
  shared.refs += 1;

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    forEvent?.delete(listener);
    if (onDown) shared.onDown.delete(onDown);
    shared.refs -= 1;
    if (shared.refs === 0) {
      shared.source.close();
      streams.delete(url);
    }
  };
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
