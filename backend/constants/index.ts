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
    // CPU-time slack (seconds) added on top of the wall-clock limit before the
    // in-process RLIMIT_CPU hard-kills the program. The `timeout` command still
    // owns wall-clock TLE detection; this is a defence-in-depth backstop against
    // busy-loops that the wall-clock timeout might race with.
    CPU_LIMIT_SLACK_S: 1,
    // Address-space (RLIMIT_AS) headroom (MB) added to the problem's memory limit
    // so the runtime/loader/UBSan overhead does not trip the limit before the
    // program's own allocations do. Tune conservatively.
    MEMORY_LIMIT_SLACK_MB: 32,
    // Hardened compile step (g++) guards: a malicious/pathological source must
    // not be able to hang the single-threaded judge worker forever.
    COMPILE_TIMEOUT_MS: 10000, // 10s wall-clock cap on g++
    COMPILE_MAX_BUFFER: 10 * 1024 * 1024, // 10MB cap on compiler stdout/stderr
    // Minimal PATH handed to executed user code so it cannot inherit the
    // backend's secrets (DATABASE_URL/PGPASSWORD/SECRET_KEY) via getenv().
    SANDBOX_PATH: '/usr/bin:/bin',
} as const;


export const FILE_CONFIG = {
    CLEANUP_DELAY_MS: 200,
    MAX_UPLOAD_SIZE_BYTES: 2 * 1024 * 1024 * 1024, // 2 GiB
} as const;
