/**
 * Backend Constants
 */

export const USER_ROLES = {
    ADMIN: 'admin',
    STAFF: 'staff',
    USER: 'user',
} as const;

export const CONTEST_STATUS = {
    SCHEDULED: 'scheduled',
    RUNNING: 'running',
    FINISHING: 'finishing',
    FINISHED: 'finished',
} as const;

export const SUBMISSION_STATUS = {
    PENDING: 'Pending',
    COMPILING: 'Compiling',
    COMPILATION_ERROR: 'Compilation Error',
    RUNNING: 'Running',
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
    MAX_CATEGORY_LENGTH: 50,
    MIN_TIME_LIMIT_MS: 100,
    MIN_MEMORY_LIMIT_MB: 1,
} as const;

export const SECURITY_CONFIG = {
    SALT_ROUNDS: 10,
    SESSION_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;

export const SUBMISSION_QUERY_CONFIG = {
    // Cap for the submissions list endpoints (main + contest views).
    LIST_LIMIT: 200,
    // A problem is counted as solved when the best score reaches the full
    // per-problem maximum of 100 points.
    FULL_PROBLEM_SCORE: 100,
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
    // Maximum number of submissions compiled/run concurrently; excess are queued.
    MAX_CONCURRENT_JUDGES: 3,
} as const;

export const SUBMISSION_VALIDATION = {
    // Maximum source code size accepted for a submission (characters).
    MAX_CODE_LENGTH: 65536, // 64 KiB
} as const;

export const AUTHORING_VALIDATION = {
    MAX_PROBLEM_ID_LENGTH: 50,
    MAX_TITLE_LENGTH: 255,
    MAX_AKA_NAME_LENGTH: 100,
    MAX_REAL_NAME_LENGTH: 255,
    MAX_LANGUAGE_LENGTH: 50,
    COUNTRY_CODE_LENGTH: 3,
    MAX_TEMPLATE_VERSION_LENGTH: 50,
    MAX_SOURCE_BYTES: 2 * 1024 * 1024,
    MAX_JSON_BODY_BYTES: 7 * 1024 * 1024,
    MAX_INT: 2_147_483_647,
} as const;

const AUTHOR_PROFILE_MAX_UPLOAD_MIB = 10;

export const AUTHOR_PROFILE_IMAGE = {
    SIZE_PX: 512,
    MAX_INPUT_PIXELS: 25_000_000,
    FIELD_NAME: 'profileImage',
    MAX_UPLOAD_MIB: AUTHOR_PROFILE_MAX_UPLOAD_MIB,
    MAX_UPLOAD_BYTES: AUTHOR_PROFILE_MAX_UPLOAD_MIB * 1024 * 1024,
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

const USER_AVATAR_MAX_UPLOAD_MIB = 10;

export const USER_AVATAR = {
    SIZE_PX: 256,
    MAX_INPUT_PIXELS: 25_000_000,
    FIELD_NAME: 'avatar',
    MAX_UPLOAD_MIB: USER_AVATAR_MAX_UPLOAD_MIB,
    MAX_UPLOAD_BYTES: USER_AVATAR_MAX_UPLOAD_MIB * 1024 * 1024,
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

export const PROFILE_ACTIVITY_WINDOW_DAYS = 365;

const STATEMENT_ASSET_MAX_FILE_MIB = 10;
const STATEMENT_ASSET_MAX_TOTAL_MIB = 100;

export const STATEMENT_ASSET = {
    MAX_FILENAME_LENGTH: 255,
    MAX_INPUT_PIXELS: 25_000_000,
    MAX_FILE_MIB: STATEMENT_ASSET_MAX_FILE_MIB,
    MAX_FILE_BYTES: STATEMENT_ASSET_MAX_FILE_MIB * 1024 * 1024,
    MAX_TOTAL_MIB: STATEMENT_ASSET_MAX_TOTAL_MIB,
    MAX_TOTAL_BYTES: STATEMENT_ASSET_MAX_TOTAL_MIB * 1024 * 1024,
    FIELD_NAME: 'asset',
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

export const RATE_LIMIT_CONFIG = {
    // General API limiter. Budget set for real app behavior: every page load
    // costs ~2 requests (/me + /settings/registration) before any data fetch,
    // and an authoring session polls drafts/jobs continuously — observed
    // normal usage is ~350 requests per 15min, so 1000 leaves headroom for
    // bursts while still bounding scripted abuse.
    GENERAL_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    GENERAL_MAX: 1000,
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

// --- Archive safety limits (zip-slip / zip-bomb protection) ---
// Caps on the *uncompressed* contents of an uploaded archive. These guard
// against decompression bombs (a tiny zip that expands to gigabytes / millions
// of files) before we extract anything to disk.
export const ARCHIVE_LIMITS = {
    MAX_UNCOMPRESSED_BYTES: 500 * 1024 * 1024, // 500 MB total
    MAX_ENTRIES: 5000, // file count
} as const;
