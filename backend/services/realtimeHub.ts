import { logger } from '../utils/logger';

/**
 * Realtime hub — a tiny in-process pub/sub for Server-Sent Events.
 *
 * The judge pipeline publishes submission/scoreboard transitions here; the
 * SSE controller (`realtimeController`) subscribes per connected client and
 * relays matching events. No Redis: the backend is single-instance today
 * (the same assumption `judgeQueue` makes), so a listener set is enough.
 */

/** Emitted after every persisted status/score transition of a submission. */
export type SubmissionUpdateEvent = {
  type: 'submission_update';
  submissionId: number;
  table: 'submissions' | 'contest_submissions';
  overall_status: string;
  score: number;
  /** Owning user — used by the controller for server-side per-user filtering. */
  user_id: number | null;
};

/** Emitted when a contest scoreboard's underlying data changed. */
export type ScoreboardUpdateEvent = {
  type: 'scoreboard_update';
  contestId: number;
};

export type RealtimeEvent = SubmissionUpdateEvent | ScoreboardUpdateEvent;

export type RealtimeListener = (event: RealtimeEvent) => void;

const listeners = new Set<RealtimeListener>();

/**
 * Publish an event to every subscriber. Never throws: a broken subscriber
 * must not take down the judge pipeline — listener errors are logged and
 * swallowed.
 */
export const publishRealtime = (event: RealtimeEvent): void => {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.warn('realtime listener failed', { err: error });
    }
  }
};

/**
 * Subscribe to hub events. Returns an unsubscribe function; calling it more
 * than once is a no-op.
 */
export const subscribeRealtime = (listener: RealtimeListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Exposed for tests: how many listeners are currently subscribed. */
export const realtimeListenerCount = (): number => listeners.size;
