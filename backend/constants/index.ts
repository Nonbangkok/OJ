/**
 * Backend Constants
 */

export const USER_ROLES = {
    ADMIN: 'admin',
    STAFF: 'staff',
    USER: 'user',
} as const;

export const CONTEST_STATUS = {
    RUNNING: 'running',
    FINISHED: 'finished',
    FINISHING: 'finishing',
} as const;

export const SUBMISSION_STATUS = {
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    WRONG_ANSWER: 'Wrong Answer',
    TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
    MEMORY_LIMIT_EXCEEDED: 'Memory Limit Exceeded',
    RUNTIME_ERROR: 'Runtime Error',
    SYSTEM_ERROR: 'System Error',
    SKIPPED: 'Skipped',
} as const;

export const UPLOAD_STATUS = {
    ADDED: 'added',
    SKIPPED: 'skipped',
} as const;

export const USER_VALIDATION = {
    MIN_USERNAME_LENGTH: 3,
    MIN_PASSWORD_LENGTH: 6,
    BATCH_MAX_COUNT: 100,
    RANDOM_PASSWORD_LENGTH: 16,
} as const;

export const PROBLEM_VALIDATION = {
    MIN_TITLE_LENGTH: 1,
    MIN_AUTHOR_LENGTH: 1,
    MIN_TIME_LIMIT_MS: 100,
    MIN_MEMORY_LIMIT_MB: 1,
} as const;

export const SECURITY_CONFIG = {
    SALT_ROUNDS: 10,
} as const;

export const JUDGE_CONFIG = {
    EXEC_MAX_BUFFER: 50 * 1024 * 1024, // 50MB
    TIMEOUT_BUFFER_MS: 500,
    TLE_EXIT_CODE: 124,
    // Maximum number of submissions compiled/run concurrently; excess are queued.
    MAX_CONCURRENT_JUDGES: 3,
} as const;

export const SUBMISSION_VALIDATION = {
    // Maximum source code size accepted for a submission (characters).
    MAX_CODE_LENGTH: 65536, // 64 KiB
} as const;

export const RATE_LIMIT_CONFIG = {
    // General API limiter.
    GENERAL_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    GENERAL_MAX: 300,
    // Auth endpoints (login/register) — protect against brute force.
    AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    AUTH_MAX: 10,
    // Submission endpoint — protect against submission spam DoS.
    SUBMIT_WINDOW_MS: 60 * 1000, // 1 minute
    SUBMIT_MAX: 30,
} as const;

// Generous-but-finite caps for otherwise unbounded user-supplied strings.
export const STRING_LIMITS = {
    USERNAME: 64,
    PASSWORD: 256,
    PREFIX: 64,
    TITLE: 256,
    AUTHOR: 256,
} as const;


export const FILE_CONFIG = {
    CLEANUP_DELAY_MS: 200,
    MAX_UPLOAD_SIZE_BYTES: 2 * 1024 * 1024 * 1024, // 2 GiB
} as const;
