/**
 * Frontend Constants — tunable UI timing (polling intervals, message
 * timeouts, editor defaults). Domain values that mirror the backend
 * (roles, submission statuses, app limits) live in utils/constants.ts.
 */

export const POLLING_INTERVALS = {
  CONTEST_GUARD: 15000,
  SCOREBOARD: 30000,
  SUBMISSIONS: 2500,
  BATCH_PROCESS: 2000,
} as const;

/**
 * Realtime (SSE) tuning. While the EventSource stream is healthy, interval
 * polling is only a slow safety net; if the stream dies for good
 * (readyState === CLOSED — e.g. auth failure or server error), the hooks
 * revert to their original fast intervals.
 */
export const REALTIME = {
  SUBMISSIONS_FALLBACK_POLL_MS: 30000,
  SCOREBOARD_FALLBACK_POLL_MS: 5 * 60 * 1000,
  /** Scoreboard poll while the realtime stream is down (matches the pre-SSE value). */
  SCOREBOARD_POLL_WHEN_STREAM_DOWN_MS: POLLING_INTERVALS.SCOREBOARD,
} as const;

export const UI_TIMEOUTS = {
  SUCCESS_MESSAGE_SHORT: 3000,
  SUCCESS_MESSAGE_LONG: 5000,
  COPY_CLIPBOARD: 2000,
  MODAL_CHECK: 50,
} as const;

export const UI_CONFIG = {
  DEFAULT_EDITOR_FONT_SIZE: 16,
} as const;
