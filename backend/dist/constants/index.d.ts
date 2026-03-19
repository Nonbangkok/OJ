/**
 * Backend Constants
 */
export declare const USER_ROLES: {
    readonly ADMIN: "admin";
    readonly STAFF: "staff";
    readonly USER: "user";
};
export declare const CONTEST_STATUS: {
    readonly RUNNING: "running";
    readonly FINISHED: "finished";
    readonly FINISHING: "finishing";
};
export declare const SUBMISSION_STATUS: {
    readonly PENDING: "Pending";
    readonly ACCEPTED: "Accepted";
    readonly WRONG_ANSWER: "Wrong Answer";
    readonly TIME_LIMIT_EXCEEDED: "Time Limit Exceeded";
    readonly MEMORY_LIMIT_EXCEEDED: "Memory Limit Exceeded";
    readonly RUNTIME_ERROR: "Runtime Error";
    readonly SYSTEM_ERROR: "System Error";
    readonly SKIPPED: "Skipped";
};
export declare const UPLOAD_STATUS: {
    readonly ADDED: "added";
    readonly SKIPPED: "skipped";
};
export declare const USER_VALIDATION: {
    readonly MIN_USERNAME_LENGTH: 3;
    readonly MIN_PASSWORD_LENGTH: 6;
    readonly BATCH_MAX_COUNT: 100;
    readonly RANDOM_PASSWORD_LENGTH: 16;
};
export declare const PROBLEM_VALIDATION: {
    readonly MIN_TITLE_LENGTH: 1;
    readonly MIN_AUTHOR_LENGTH: 1;
    readonly MIN_TIME_LIMIT_MS: 100;
    readonly MIN_MEMORY_LIMIT_MB: 1;
};
export declare const SECURITY_CONFIG: {
    readonly SALT_ROUNDS: 10;
};
export declare const JUDGE_CONFIG: {
    readonly EXEC_MAX_BUFFER: number;
    readonly TIMEOUT_BUFFER_MS: 500;
    readonly TLE_EXIT_CODE: 124;
};
export declare const FILE_CONFIG: {
    readonly CLEANUP_DELAY_MS: 200;
};
