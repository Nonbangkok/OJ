/**
 * Application-wide constants: domain values that mirror the backend
 * (roles, submission statuses) plus app-level limits.
 * Tunable UI timing (polling intervals, message timeouts) lives in
 * config/constants.ts — keep that split when adding new constants.
 */
export const APP_CONSTANTS = {
  SYSTEM_ADMIN_USERNAME: 'Nonbangkok',
  SUBMISSION_CACHE_EXPIRY: 30 * 60 * 1000, // 30 minutes in milliseconds
  LARGE_UPLOAD_WARNING_BYTES: 100 * 1024 * 1024,
} as const;

/**
 * Account validation limits, mirroring the backend USER_VALIDATION /
 * STRING_LIMITS constants so client-side checks match server-side Zod
 * schemas exactly (see backend/constants/index.ts).
 */
export const USER_VALIDATION = {
  MIN_USERNAME_LENGTH: 3,
  MIN_PASSWORD_LENGTH: 8,
} as const;

export const STRING_LIMITS = {
  USERNAME: 50,
  PASSWORD: 256,
} as const;

export const USER_ROLES = {
  USER: 'user',
  STAFF: 'staff',
  ADMIN: 'admin',
} as const;

export const SUBMISSION_STATUS = {
  PENDING: 'Pending',
  COMPILING: 'Compiling',
  RUNNING: 'Running',
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong Answer',
  TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
  RUNTIME_ERROR: 'Runtime Error',
  MEMORY_LIMIT_EXCEEDED: 'Memory Limit Exceeded',
  COMPILATION_ERROR: 'Compilation Error',
  SKIPPED: 'Skipped',
} as const;

/** Closed set of submission languages, mirroring backend SUPPORTED_LANGUAGES. */
export const SUPPORTED_LANGUAGES = ['cpp', 'python'] as const;
export type SubmissionLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Display names for the submission languages. Unknown keys fall back to the
 *  raw language string at the call site (see getLanguageDisplayName). */
export const LANGUAGE_DISPLAY_NAMES: Record<SubmissionLanguage, string> = {
  cpp: 'C++',
  python: 'Python',
};

/** Map a submission language key to its display name; unknown keys (e.g. a
 *  stale value from an older row) map to the raw string itself. */
export function getLanguageDisplayName(language: string): string {
  return (LANGUAGE_DISPLAY_NAMES as Record<string, string>)[language] ?? language;
}

/** Closed set of problem categories, mirroring backend PROBLEM_CATEGORIES.
 *  A problem may carry several; an empty selection means uncategorized. */
export const PROBLEM_CATEGORIES = [
  'Dynamic Programming',
  'Greedy',
  'Graph',
  'Tree',
  'Data Structures',
  'String',
  'Math',
  'Geometry',
  'Divide and Conquer',
  'Binary Search',
  'Constructive',
  'Bitmasks',
  'Sorting',
  '2D-Grid',
  'Implementation',
  'Other',
] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

/** Problem difficulty scale, mirroring backend PROBLEM_DIFFICULTY_*. */
export const PROBLEM_DIFFICULTY_MIN = 800;
export const PROBLEM_DIFFICULTY_MAX = 3500;
export const PROBLEM_DIFFICULTY_STEP = 100;

/** Every selectable difficulty value on the scale, ascending. */
export const PROBLEM_DIFFICULTY_OPTIONS: readonly number[] = Array.from(
  { length: (PROBLEM_DIFFICULTY_MAX - PROBLEM_DIFFICULTY_MIN) / PROBLEM_DIFFICULTY_STEP + 1 },
  (_, index) => PROBLEM_DIFFICULTY_MIN + index * PROBLEM_DIFFICULTY_STEP,
);

/**
 * Heat-map band boundaries for the difficulty chip (1–5), mirroring the
 * backend PROBLEM_DIFFICULTY_BANDS data: the first entry covering the value
 * wins. null (Unrated) maps to null.
 */
const DIFFICULTY_BANDS: readonly { max: number; band: number }[] = [
  { max: 1100, band: 1 }, // 800–1100 green
  { max: 1600, band: 2 }, // 1200–1600 yellow
  { max: 2100, band: 3 }, // 1700–2100 orange
  { max: 2700, band: 4 }, // 2200–2700 red
  { max: 3500, band: 5 }, // 2800–3500 purple
];

/** Map a difficulty to its 1–5 display band; null/undefined (Unrated) → null. */
export function difficultyBand(difficulty: number | null | undefined): number | null {
  if (difficulty === null || difficulty === undefined) return null;
  return DIFFICULTY_BANDS.find(boundary => difficulty <= boundary.max)?.band ?? null;
}
