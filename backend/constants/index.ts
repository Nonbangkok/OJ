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
    MIN_PASSWORD_LENGTH: 8,
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

/** The closed set of problem categories. Problems may also be uncategorized (null). */
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

/** Problem difficulty lives on a Codeforces-like numeric scale. */
export const PROBLEM_DIFFICULTY_MIN = 800;
export const PROBLEM_DIFFICULTY_MAX = 3500;
export const PROBLEM_DIFFICULTY_STEP = 100;

/**
 * Heat-map band boundaries for difficulty display, expressed as data: the
 * first entry whose `max` covers the value wins. A null difficulty (Unrated)
 * maps to null — there is no band for it.
 */
export const PROBLEM_DIFFICULTY_BANDS: readonly { max: number; band: number }[] = [
  { max: 1100, band: 1 }, // 800–1100 green
  { max: 1600, band: 2 }, // 1200–1600 yellow
  { max: 2100, band: 3 }, // 1700–2100 orange
  { max: 2700, band: 4 }, // 2200–2700 red
  { max: 3500, band: 5 }, // 2800–3500 purple
];

/** Map a difficulty to its 1–5 display band; null (Unrated) → null. */
export function difficultyBand(difficulty: number | null): number | null {
  if (difficulty === null) return null;
  return PROBLEM_DIFFICULTY_BANDS.find(boundary => difficulty <= boundary.max)?.band ?? null;
}

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
    // Upper bound on rows included in one analytics CSV export.
    EXPORT_MAX_ROWS: 10000,
} as const;

export const JUDGE_CONFIG = {
    EXEC_MAX_BUFFER: 50 * 1024 * 1024, // 50MB
    TIMEOUT_BUFFER_MS: 500,
    // Grace period after the wall-clock limit before a judge execution is
    // SIGKILLed outright (RUNNER-004). GNU `timeout` runs with `-k` using this
    // grace, and the Node-side kill escalation backs it up: a program that
    // ignores SIGTERM can no longer hold a judge slot indefinitely.
    KILL_GRACE_MS: 2000,
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
    // --- Sandbox identities (RUNNER-003 / RUNNER-006) ---
    // Compiles and testcase runs of one submission share an identity (uid and
    // matching gid) drawn from this rotating pool, so no two LIVE submissions
    // share an identity. Distinct uids make RLIMIT_NPROC independent per
    // submission (one submission forking toward its cap cannot starve a
    // concurrent one), and identity-owned files/directories are private to
    // their submission. The pool must stay comfortably larger than
    // MAX_CONCURRENT_JUDGES.
    SANDBOX_UID_BASE: 60000,
    SANDBOX_UID_POOL_SIZE: 16,
    // --- Compile-step resource caps (RUNNER-005), mirroring the authoring
    // compiler's prlimit recipe ---
    PRLIMIT_PATH: '/usr/bin/prlimit',
    COMPILE_AS_LIMIT_BYTES: 768 * 1024 * 1024,  // RLIMIT_AS: 768MB address space
    COMPILE_NPROC_LIMIT: 128,                   // RLIMIT_NPROC for the compile uid
    COMPILE_FSIZE_LIMIT_BYTES: 64 * 1024 * 1024, // RLIMIT_FSIZE: 64MB (output binary + temp)
} as const;

// --- Submission languages ---

/** The closed set of languages a submission may be written in. */
export const SUPPORTED_LANGUAGES = ['cpp', 'python'] as const;
export type SubmissionLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Per-language judge multipliers applied to a problem's raw limits. One
 * problem serves every language: an interpreter is slower and heavier than
 * compiled C++, so Python gets time x4 / memory x2. C++ is the identity.
 */
export const LANGUAGE_LIMITS: Record<SubmissionLanguage, {
    timeMultiplier: number;   // C++ = 1, Python = 4
    memoryMultiplier: number; // C++ = 1, Python = 2
}> = {
    cpp: { timeMultiplier: 1, memoryMultiplier: 1 },
    python: { timeMultiplier: 4, memoryMultiplier: 2 },
};

/** The runnable command the judge executes for a submission. */
export interface RunnableCommand {
    command: string;
    args: string[];
}

/**
 * Per-language "prepare" recipe: how a submission's source is turned into a
 * runnable command. Every language defines
 *  - `sourceExtension`  — file suffix for the written source,
 *  - `checkCommand(src, out)` — the compile/verification phase invocation
 *    (g++ for C++, `python3 -m py_compile` for Python — a fast syntax check
 *    whose failure maps to Compilation Error), as an argv array: the compile
 *    is executed WITHOUT a shell (see submissionService's bounded compile),
 *  - `runCommand(src | out)` — what the judge executes,
 *  - `compiledArtifactPath(out)` — the produced artifact to chmod/unlink, or
 *    null for interpreted languages that produce none.
 */
export const LANGUAGE_PREPARE: Record<SubmissionLanguage, {
    sourceExtension: string;
    checkCommand: (sourcePath: string, outputPath: string) => RunnableCommand;
    runCommand: (path: string) => RunnableCommand;
    compiledArtifactPath: (outputPath: string) => string | null;
}> = {
    cpp: {
        sourceExtension: '.cpp',
        // UndefinedBehaviorSanitizer reliably catches signed integer overflow
        // as a runtime error.
        checkCommand: (sourcePath, outputPath) => ({
            command: 'g++',
            args: ['-std=c++20', '-fsanitize=signed-integer-overflow', sourcePath, '-o', outputPath],
        }),
        runCommand: (binaryPath) => ({ command: binaryPath, args: [] }),
        compiledArtifactPath: (outputPath) => outputPath,
    },
    python: {
        sourceExtension: '.py',
        // No compile step — verify syntax only. Stdlib interpreter, stdlib only.
        checkCommand: (sourcePath) => ({ command: 'python3', args: ['-m', 'py_compile', sourcePath] }),
        // Absolute interpreter path: the sandbox wrapper execs this directly
        // via execv(), which does NO PATH lookup — a bare "python3" would
        // fail with ENOENT. The Dockerfile asserts python3 lives at
        // /usr/bin/python3 (inside SANDBOX_PATH).
        runCommand: (sourcePath) => ({ command: '/usr/bin/python3', args: [sourcePath] }),
        compiledArtifactPath: () => null,
    },
};

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

// --- Achievements -----------------------------------------------------------

/**
 * Serializable statistics an achievement check runs over. Derived in the
 * profile query from submission history — no stored state.
 */
export interface AchievementStats {
    /** Distinct problems with a full-score (Accepted) submission. */
    problemsSolved: number;
    /** Longest run of consecutive AC days (Asia/Bangkok day boundary). */
    longestStreak: number;
    /** Consecutive AC days ending today or yesterday. */
    currentStreak: number;
    /** Distinct languages with at least one AC, keyed by language → AC count. */
    languagesSolvedIn: Record<string, number>;
    /** Count of contest_participants rows for the user. */
    contestsJoined: number;
}

/** A fixed achievement: pure check over serializable stats. */
export interface Achievement {
    id: string;
    name: string;
    description: string;
    check: (stats: AchievementStats) => boolean;
}

/**
 * The achievement catalog — the complete, code-defined set. Unlocked purely
 * by derivable statistics; no admin management, no stored unlock state.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
    {
        id: 'first_solve',
        name: 'First Solve',
        description: 'Solve your first problem',
        check: (s) => s.problemsSolved >= 1,
    },
    {
        id: 'ten_solves',
        name: 'Getting Started',
        description: 'Solve 10 problems',
        check: (s) => s.problemsSolved >= 10,
    },
    {
        id: 'fifty_solves',
        name: 'Problem Grinder',
        description: 'Solve 50 problems',
        check: (s) => s.problemsSolved >= 50,
    },
    {
        id: 'hundred_solves',
        name: 'Century',
        description: 'Solve 100 problems',
        check: (s) => s.problemsSolved >= 100,
    },
    {
        id: 'streak_7',
        name: 'On Fire',
        description: 'Reach a 7-day AC streak',
        check: (s) => s.longestStreak >= 7,
    },
    {
        id: 'streak_30',
        name: 'Unstoppable',
        description: 'Reach a 30-day AC streak',
        check: (s) => s.longestStreak >= 30,
    },
    {
        id: 'polyglot',
        name: 'Polyglot',
        description: 'Solve a problem in 2 or more languages',
        check: (s) => Object.values(s.languagesSolvedIn).filter((count) => count >= 1).length >= 2,
    },
    {
        id: 'contester',
        name: 'Contester',
        description: 'Participate in your first contest',
        check: (s) => s.contestsJoined >= 1,
    },
];

/** Lookup of the catalog by id. */
export const ACHIEVEMENT_BY_ID: Readonly<Record<string, Achievement>> =
    Object.fromEntries(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));

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

/** SSE realtime stream tuning (see services/realtimeHub.ts + realtimeController). */
export const REALTIME_CONFIG = {
    // Heartbeat comment cadence — well inside the 300s nginx read timeout so
    // idle streams stay open without tripping intermediaries.
    HEARTBEAT_INTERVAL_MS: 30_000,
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
    // Per-account login throttle (AUTH-001): a failed-password counter per
    // username that locks the account out. IP rotation defeats pure IP
    // keying, so the per-account counter is the load-bearing defense; the
    // window/memory caps keep the in-memory map bounded.
    LOGIN_FAILURE_WINDOW_MS: 15 * 60 * 1000, // failures expire after 15 minutes
    LOGIN_FAILURE_MAX: 10, // ...within the window
    LOGIN_LOCKOUT_MS: 15 * 60 * 1000, // lockout duration once MAX is hit
    LOGIN_TRACKER_MAX_ACCOUNTS: 10_000, // eviction cap for the tracker map
    // Submission endpoint — protect against submission spam DoS.
    SUBMIT_WINDOW_MS: 60 * 1000, // 1 minute
    SUBMIT_MAX: 30,
} as const;

// Generous-but-finite caps for otherwise unbounded user-supplied strings.
export const STRING_LIMITS = {
    // Must match users.username VARCHAR(50) (migrations/0001CoreSchema.ts) —
    // a larger cap passes Zod but 500s on the INSERT.
    USERNAME: 50,
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
