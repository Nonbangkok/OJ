/**
 * Strongly-typed interfaces that mirror the PostgreSQL schema.
 * Source of truth: .context/DATA_MODEL.md
 *
 * Each interface maps directly to one table row as returned by pg.
 * Use these as the generic parameter for `db.query<T>()`.
 */

// ---------------------------------------------------------------------------
// Primitives / Shared
// ---------------------------------------------------------------------------

/** The full set of valid user roles enforced by the DB CHECK constraint. */
export type UserRole = 'user' | 'staff' | 'admin';

export type ContestStatus = 'scheduled' | 'running' | 'finishing' | 'finished';

/** Statuses where a contest is effectively active or completed (problems are visible). */
export const ACTIVE_CONTEST_STATUSES: ContestStatus[] = ['running', 'finishing', 'finished'];


/**
 * Possible values for `overall_status` on a submission.
 * Covers all states produced by the judge service.
 */
export type SubmissionStatus =
    | 'pending'
    | 'judging'
    | 'Accepted'
    | 'Wrong Answer'
    | 'Time Limit Exceeded'
    | 'Memory Limit Exceeded'
    | 'Runtime Error'
    | 'Compile Error'
    | 'System Error'
    | 'Partial';

/**
 * A single element inside `submissions.results` / `contest_submissions.results` (JSONB).
 * `timeMs` and `memoryKb` are absent for skipped test cases.
 */
export interface TestCaseResult {
    testCase: number;
    status: string;
    timeMs?: number;
    memoryKb?: number;
}

/**
 * A typed PostgreSQL error.  Cast `unknown` catch-clause errors to this via
 * `isPgError()` before accessing `.code`.
 */
export interface PgError {
    code?: string;
    message: string;
}

/** Narrow an unknown catch value to `PgError`. */
export function isPgError(err: unknown): err is PgError {
    return typeof err === 'object' && err !== null && 'message' in err;
}

// ---------------------------------------------------------------------------
// Table Row Interfaces
// ---------------------------------------------------------------------------

/** `users` table row. */
export interface UserRow {
    id: number;
    username: string;
    password_hash: string;
    role: UserRole;
    created_at: Date;
}

/** `system_settings` table row. */
export interface SystemSettingRow {
    setting_key: string;
    setting_value: string;
}

/** `problems` table row (all columns). */
export interface ProblemRow {
    id: string;
    title: string;
    author: string | null;
    problem_pdf: Buffer | null;
    time_limit_ms: number;
    memory_limit_mb: number;
    is_visible: boolean;
    contest_id: number | null;
}

export type ProblemWithPdf = Pick<
    ProblemRow,
    'id' | 'title' | 'author' | 'time_limit_ms' | 'memory_limit_mb' | 'problem_pdf'
>

export type ProblemDetailDTO = Pick<
    ProblemRow,
    'id' | 'title' | 'author' | 'time_limit_ms' | 'memory_limit_mb' | 'is_visible'
> & {
    has_pdf: boolean
}

/** `problems` row augmented with contest status for the admin index. */
export interface AdminProblemRow extends Pick<
    ProblemRow,
    'id' | 'title' | 'author' | 'is_visible' | 'contest_id'
> {
    contest_status: ContestStatus | null;
}

/** `testcases` table row. */
export interface TestcaseRow {
    id: number;
    problem_id: string;
    case_number: number;
    input_data: string;
    output_data: string;
}

/** `submissions` table row. */
export interface SubmissionRow {
    id: number;
    user_id: number | null;
    problem_id: string;
    code: string;
    language: string;
    overall_status: SubmissionStatus;
    score: number;
    results: TestCaseResult[] | null;
    max_time_ms: number | null;
    max_memory_kb: number | null;
    submitted_at: Date;
}


/** `submissions` row augmented with username for display. */
export interface SubmissionDetailRow extends SubmissionRow {
    username: string;
}


/** `contests` table row. */
export interface ContestRow {
    id: number;
    title: string;
    description: string | null;
    start_time: Date;
    end_time: Date;
    status: ContestStatus;
    created_at: Date;
    created_by: number | null;
}

/** `contests` row augmented with participant count and author username. */
export interface ContestDetailRow extends ContestRow {
    participant_count: string;
    created_by_username: string | null;
}

/** `contest_submissions` table row. */
export interface ContestSubmissionRow {
    id: number;
    contest_id: number;
    user_id: number | null;
    problem_id: string;
    code: string;
    language: string;
    overall_status: SubmissionStatus;
    score: number;
    results: TestCaseResult[] | null;
    max_time_ms: number | null;
    max_memory_kb: number | null;
    submitted_at: Date;
}


/** `contest_submissions` row augmented with username for display. */
export interface ContestSubmissionDetailRow extends ContestSubmissionRow {
    username: string;
}


/**
 * `contest_problems` table row.
 * This is a **snapshot** — data is copied from `problems` at contest creation.
 */
export interface ContestProblemRow {
    contest_id: number;
    problem_id: string;
    title: string;
    author: string | null;
    time_limit_ms: number;
    memory_limit_mb: number;
    /** The PDF is only available when explicitly selected (BYTEA). */
    problem_pdf?: Buffer | null;
    created_at: Date;
}

/** `contest_scoreboards` table row. */
export interface ContestScoreboardRow {
    contest_id: number;
    user_id: number;
    total_score: number;
    /** Maps problem_id → best score for that problem. */
    detailed_scores: Record<string, number>;
    last_score_improvement_time: Date | null;
}

/** `contest_scoreboards` row augmented with username for display. */
export interface ContestScoreboardDetailRow extends ContestScoreboardRow {
    username: string;
}

