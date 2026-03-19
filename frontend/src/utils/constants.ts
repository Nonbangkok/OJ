/**
 * Application-wide constants.
 */
export const APP_CONSTANTS: Record<string, string | number> = {
    SYSTEM_ADMIN_USERNAME: 'Nonbangkok',
    SUBMISSION_CACHE_EXPIRY: 30 * 60 * 1000, // 30 minutes in milliseconds
};

export const USER_ROLES: Record<string, string> = {
    USER: 'user',
    STAFF: 'staff',
    ADMIN: 'admin'
};

export const SUBMISSION_STATUS: Record<string, string> = {
    PENDING: 'Pending',
    COMPILING: 'Compiling',
    RUNNING: 'Running',
    ACCEPTED: 'Accepted',
    WRONG_ANSWER: 'Wrong Answer',
    TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
    RUNTIME_ERROR: 'Runtime Error',
    MEMORY_LIMIT_EXCEEDED: 'Memory Limit Exceeded',
    COMPILATION_ERROR: 'Compilation Error',
    SKIPPED: 'Skipped'
};