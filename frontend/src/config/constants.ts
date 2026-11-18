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

/**
 * Settings -> Replace database progress polling (A2-07). A failed poll is
 * retried after INTERVAL_MS × (failures + 1); after MAX_CONSECUTIVE_FAILURES
 * in a row the dialog stops waiting and reports the lost contact.
 */
export const IMPORT_PROGRESS_POLLING = {
  INTERVAL_MS: 3000,
  MAX_CONSECUTIVE_FAILURES: 3,
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
  // Ratings step by 100 and the API accepts only multiples of 100 as bounds,
  // so each band ends on the last rating it contains (…–1100, not …–1199).
  { value: '800-1100', label: '800–1100', min: 800, max: 1100 },
  { value: '1200-1500', label: '1200–1500', min: 1200, max: 1500 },
  { value: '1600-1900', label: '1600–1900', min: 1600, max: 1900 },
  { value: '2000-2300', label: '2000–2300', min: 2000, max: 2300 },
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

/** Admin batch user creation; mirrors USER_VALIDATION.BATCH_MAX_COUNT on the backend. */
export const ADMIN_USERS = {
  BATCH_MAX_COUNT: 100,
} as const;
