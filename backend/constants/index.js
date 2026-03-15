/**
 * Backend Constants
 */

const USER_ROLES = {
    ADMIN: 'admin',
    STAFF: 'staff',
    USER: 'user',
};

const CONTEST_STATUS = {
    RUNNING: 'running',
    FINISHED: 'finished',
    FINISHING: 'finishing',
};

const SUBMISSION_STATUS = {
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    WRONG_ANSWER: 'Wrong Answer',
    TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
    MEMORY_LIMIT_EXCEEDED: 'Memory Limit Exceeded',
    RUNTIME_ERROR: 'Runtime Error',
    SYSTEM_ERROR: 'System Error',
    SKIPPED: 'Skipped',
};

const UPLOAD_STATUS = {
    ADDED: 'added',
    SKIPPED: 'skipped',
};

const USER_VALIDATION = {
    MIN_USERNAME_LENGTH: 3,
    MIN_PASSWORD_LENGTH: 6,
    BATCH_MAX_COUNT: 100,
    RANDOM_PASSWORD_LENGTH: 16,
};

const PROBLEM_VALIDATION = {
    MIN_TITLE_LENGTH: 1,
    MIN_AUTHOR_LENGTH: 1,
    MIN_TIME_LIMIT_MS: 100,
    MIN_MEMORY_LIMIT_MB: 1,
};

const SECURITY_CONFIG = {
    SALT_ROUNDS: 10,
};

const JUDGE_CONFIG = {
    EXEC_MAX_BUFFER: 50 * 1024 * 1024, // 50MB
    TIMEOUT_BUFFER_MS: 500,
    TLE_EXIT_CODE: 124,
};

const FILE_CONFIG = {
    CLEANUP_DELAY_MS: 200,
};

module.exports = {
    USER_ROLES,
    CONTEST_STATUS,
    SUBMISSION_STATUS,
    UPLOAD_STATUS,
    USER_VALIDATION,
    PROBLEM_VALIDATION,
    SECURITY_CONFIG,
    JUDGE_CONFIG,
    FILE_CONFIG,
};
