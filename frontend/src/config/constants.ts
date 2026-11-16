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

/**
 * Problems page incremental loading. PAGE_SIZE is the server-side batch
 * ("Show More" fetches exactly this many problems); SEARCH_DEBOUNCE_MS
 * throttles the server-side search so typing does not spam requests.
 */
export const PROBLEMS_PAGE = {
  PAGE_SIZE: 20,
  SEARCH_DEBOUNCE_MS: 300,
} as const;

/**
 * Difficulty chip choices on the Problems page. A band's value is
 * "<min>-<max>" and maps onto the difficultyMin/difficultyMax URL params.
 */
export const DIFFICULTY_BANDS: readonly { value: string; label: string; min: number; max: number }[] = [
  { value: '800-1199', label: '800–1199', min: 800, max: 1199 },
  { value: '1200-1599', label: '1200–1599', min: 1200, max: 1599 },
  { value: '1600-1999', label: '1600–1999', min: 1600, max: 1999 },
  { value: '2000-2399', label: '2000–2399', min: 2000, max: 2399 },
  { value: '2400-3500', label: '2400+', min: 2400, max: 3500 },
];

/**
 * Admin problem management incremental loading. PAGE_SIZE is the
 * server-side batch ("Show More" fetches exactly this many problems) and
 * matches ADMIN_PROBLEM_LIST_CONFIG.DEFAULT_LIMIT on the backend;
 * SEARCH_DEBOUNCE_MS throttles the server-side search.
 */
export const ADMIN_PROBLEMS_PAGE = {
  PAGE_SIZE: 25,
  SEARCH_DEBOUNCE_MS: 300,
} as const;
