"use strict";
/**
 * Backend Constants
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_CONFIG = exports.JUDGE_CONFIG = exports.SECURITY_CONFIG = exports.PROBLEM_VALIDATION = exports.USER_VALIDATION = exports.UPLOAD_STATUS = exports.SUBMISSION_STATUS = exports.CONTEST_STATUS = exports.USER_ROLES = void 0;
exports.USER_ROLES = {
    ADMIN: 'admin',
    STAFF: 'staff',
    USER: 'user',
};
exports.CONTEST_STATUS = {
    RUNNING: 'running',
    FINISHED: 'finished',
    FINISHING: 'finishing',
};
exports.SUBMISSION_STATUS = {
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    WRONG_ANSWER: 'Wrong Answer',
    TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
    MEMORY_LIMIT_EXCEEDED: 'Memory Limit Exceeded',
    RUNTIME_ERROR: 'Runtime Error',
    SYSTEM_ERROR: 'System Error',
    SKIPPED: 'Skipped',
};
exports.UPLOAD_STATUS = {
    ADDED: 'added',
    SKIPPED: 'skipped',
};
exports.USER_VALIDATION = {
    MIN_USERNAME_LENGTH: 3,
    MIN_PASSWORD_LENGTH: 6,
    BATCH_MAX_COUNT: 100,
    RANDOM_PASSWORD_LENGTH: 16,
};
exports.PROBLEM_VALIDATION = {
    MIN_TITLE_LENGTH: 1,
    MIN_AUTHOR_LENGTH: 1,
    MIN_TIME_LIMIT_MS: 100,
    MIN_MEMORY_LIMIT_MB: 1,
};
exports.SECURITY_CONFIG = {
    SALT_ROUNDS: 10,
};
exports.JUDGE_CONFIG = {
    EXEC_MAX_BUFFER: 50 * 1024 * 1024, // 50MB
    TIMEOUT_BUFFER_MS: 500,
    TLE_EXIT_CODE: 124,
};
exports.FILE_CONFIG = {
    CLEANUP_DELAY_MS: 200,
};
//# sourceMappingURL=index.js.map