import type { UserProgression } from '../services/progressionService';
import { UPLOAD_STATUS, type ProblemFileRole, type ProblemType } from '../constants';
import type { ProblemFileInput } from '../utils/headerProblemFiles';
import { ContestRow, ContestStatus, ProblemRow, SystemSettingRow, TestcaseRow, UserRow } from './models';

// ---------------------------------------------------------------------------
// Generic / Shared
// ---------------------------------------------------------------------------

export interface ExistsRow {
  exists: number;
}

export interface IdRow {
  id: number;
}

export interface IdTitlePair {
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// batchUploadService
// ---------------------------------------------------------------------------

export interface BatchUploadResult {
  added: string[];
  skipped: string[];
  errors: Array<{ directory: string; message: string }>;
}

export interface TestcasePair<TSource> {
  in?: TSource;
  out?: TSource;
}

export type TestcasePairMap<TSource> = Record<number, TestcasePair<TSource>>;

export interface AddedProblemProcessResult {
  status: typeof UPLOAD_STATUS.ADDED;
  problemId: string;
  log: string[];
}

export interface SkippedProblemProcessResult {
  status: typeof UPLOAD_STATUS.SKIPPED;
  problemId: string;
}

export type ProblemProcessResult = AddedProblemProcessResult | SkippedProblemProcessResult;

// ---------------------------------------------------------------------------
// submissionService
// ---------------------------------------------------------------------------

export interface CompileCommandError extends Error {
  stderr?: string;
}

// ---------------------------------------------------------------------------
// judgeService
// ---------------------------------------------------------------------------

export interface RunResult {
  status: string;
  timeMs: number;
  memoryKb: number;
  output?: string;
}

export interface ExecutionError extends Error {
  code?: number;
  signal?: NodeJS.Signals | null;
}

export interface JudgeProblemLimitsRow extends Pick<ProblemRow, 'time_limit_ms' | 'memory_limit_mb'> {}

export interface JudgeTestcaseRow extends Pick<TestcaseRow, 'case_number' | 'input_data' | 'output_data'> {}

export interface JudgeCaseResult {
  testCase: number;
  status: string;
  timeMs?: number;
  memoryKb?: number;
  output?: string;
}

export interface JudgeResult {
  results: JudgeCaseResult[];
  score: number;
  overallStatus: string;
  maxTimeMs: number;
  maxMemoryKb: number;
  /** Effective (language-scaled) limits the submission was judged against. */
  timeLimitMs?: number;
  memoryLimitMb?: number;
}

// ---------------------------------------------------------------------------
// problemMigration
// ---------------------------------------------------------------------------

export interface ProblemIdentityRow extends Pick<ProblemRow, 'id' | 'title'> {}

export interface ProblemContestCheckRow extends Pick<ProblemRow, 'id' | 'title' | 'contest_id'> {}

export interface ContestStatusRow extends Pick<ContestRow, 'id' | 'status'> {}

export interface ProblemMoveResult {
  success: boolean;
  message: string;
  movedProblems: ProblemIdentityRow[];
}

export interface ContestMigrationResult {
  success: boolean;
  message: string;
  migratedSubmissions: number;
  finalScoreboard: number;
}

export interface AvailableContestProblemRow extends Pick<ProblemRow, 'id' | 'title' | 'author' | 'is_visible'> {}

export interface ContestProblemListRow extends IdTitlePair {
  author: string | null;
}

// ---------------------------------------------------------------------------
// submissionQueryService
// ---------------------------------------------------------------------------

export interface QueueSubmissionResult {
  submissionId: number;
  isContestSubmission: boolean;
}

/**
 * Requester context for search endpoints — the visibility predicate is
 * role-dependent (staff/admin search the full catalog, users only the
 * publicly listed problems).
 */
export interface SearchViewer {
  userId: number;
  role: string;
}

export interface SubmissionListRow {
  id: number;
  username: string;
  problem_id: string;
  problem_title: string;
  overall_status: string;
  score: number;
  language: string;
  submitted_at: Date;
  /** Per-case statuses for the testcase strip; empty for a compile log or pending. */
  case_statuses: string[];
  max_time_ms: number | null;
  max_memory_kb: number | null;
}

export interface SearchUserRow {
  id: number;
  username: string;
}

/** One ranked user in GET /scoreboard (B3). Level and tier come from all-time XP. */
export interface RankingRow {
  rank: number;
  username: string;
  hasAvatar: boolean;
  /** XP in the requested window. */
  xp: number;
  /** First solves (reward rows) in the window. */
  solved: number;
  level: number;
  tier: string;
}

/** GET /scoreboard?window=all|week&page=N */
export interface GlobalRanking {
  rows: RankingRow[];
  total: number;
  page: number;
  pageSize: number;
  window: 'all' | 'week';
  /** The viewer's own row regardless of page; null for guests or no XP in the window. */
  viewer: RankingRow | null;
}

export interface ProblemStatsRow {
  id: string;
  title: string;
  author: string | null;
  categories: readonly string[];
  difficulty: number | null;
  /** Header problems are marked in the list. */
  problem_type: ProblemType;
  best_score: number | null;
  submission_count: string | null;
  latest_submission_at: Date | null;
  latest_submission_status: string | null;
  best_submission_status: string | null;
  best_submission_results: unknown;
}

/** A problem the Home page links to, with the XP a first solve would award. */
export interface HomeProblemRef {
  id: string;
  title: string;
  difficulty: number | null;
  xp: number;
}

/** The most recently tried, still unsolved problem. */
export interface HomeContinue extends HomeProblemRef {
  bestScore: number;
  attempts: number;
  lastTriedAt: string;
  latestStatus: string;
  /** Per-case statuses of the best submission (empty for a compile log or pending). */
  caseStatuses: string[];
}

/** B1: the viewer's progress through one collection (visible standalone problems only). */
export interface CollectionProgress {
  id: number;
  name: string;
  solved: number;
  total: number;
  /** The easiest unsolved problem in the collection, null when complete. */
  next: HomeProblemRef | null;
}

/** GET /me/home */
export interface HomeSummary {
  progression: UserProgression;
  currentStreak: number;
  solvedToday: boolean;
  /** 7 days, oldest first; the last entry is today (profile timezone). */
  week: { day: string; solved: number }[];
  continue: HomeContinue | null;
  /** Up to 3 easiest unsolved problems, only when there is nothing to continue. */
  startWith: HomeProblemRef[];
  collections: CollectionProgress[];
  levelUp: { remaining: number; problem: HomeProblemRef } | null;
}

/** Per-status problem counts for the viewer (GET /problem-status-counts); buckets partition `all`. */
export interface ProblemStatusCounts {
  all: number;
  unsolved: number;
  attempted: number;
  solved: number;
}

/** One page of the user-facing problem list (GET /problems-with-stats). */
export interface ProblemsPage {
  problems: ProblemStatsRow[];
  /** Opaque token for the next page; null when this is the last page. */
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Global category tab counts for the public problem list (visible,
 * standalone problems only).
 */
export interface ProblemCategoryCounts {
  categories: Array<{ name: string; count: number }>;
  uncategorized: number;
  total: number;
}

// ---------------------------------------------------------------------------
// problemQueryService
// ---------------------------------------------------------------------------

export interface ProblemExportTestcaseRow extends Pick<TestcaseRow, 'case_number' | 'input_data' | 'output_data'> {}

export interface ProblemExportBundle {
  problem: Pick<ProblemRow, 'id' | 'title' | 'author' | 'time_limit_ms' | 'memory_limit_mb' | 'problem_pdf' | 'categories' | 'difficulty' | 'problem_type' | 'submission_filename'> & {
    collection_name: string | null;
  };
  testcases: ProblemExportTestcaseRow[];
  /** Header problems only (empty for standard). */
  files: Array<ProblemFileInput & { role: ProblemFileRole }>;
}

export type ReplaceProblemTestcasesFromZipResult =
  | { kind: 'no_valid_pairs' }
  | { kind: 'not_found' }
  | { kind: 'ok'; insertedCount: number };

// --- Admin testcase viewer (GET /admin/problems/:id/testcases) -----------

/** Metadata row: case identity + content sizes, never the content itself. */
export interface TestcaseMetadataRow {
  case_number: number;
  input_bytes: number;
  output_bytes: number;
}

/** One side (input or output) of a fetched testcase, API-truncated. */
export interface TestcaseViewPart {
  /** True content size in bytes (before any truncation). */
  bytes: number;
  truncated: boolean;
  content: string;
}

export interface TestcaseView {
  caseNumber: number;
  input: TestcaseViewPart;
  output: TestcaseViewPart;
}

export type GetProblemTestcasesResult =
  | { kind: 'not_found' }
  | { kind: 'ok'; testcases: TestcaseMetadataRow[] }
  | { kind: 'case_not_found' }
  | { kind: 'ok_case'; testcase: TestcaseView };

// ---------------------------------------------------------------------------
// adminQueryService
// ---------------------------------------------------------------------------

export interface AdminUserListRow extends Pick<UserRow, 'id' | 'username' | 'role' | 'created_at' | 'submissions_locked'> {
  /** Latest of the last login and the last (practice or contest) submission (B5). */
  last_active_at: string | null;
  solved_count: number;
  xp: number;
  submission_count: number;
}

export interface AdminSubmissionLockRow extends Pick<UserRow, 'id' | 'username' | 'role' | 'submissions_locked'> {}

export type AdminSubmissionLockResult =
  | { kind: 'not_lockable' }
  | { kind: 'ok'; data: AdminSubmissionLockRow };

export interface AdminAuthorListRow extends Pick<UserRow, 'id' | 'username'> {}

export interface AdminCreatedUserRow extends Pick<UserRow, 'id' | 'username' | 'role'> {}

export type AdminCreateUserResult =
  | { kind: 'duplicate_username' }
  | { kind: 'ok'; data: AdminCreatedUserRow };

export type AdminUpdateUserResult =
  | { kind: 'not_found' }
  | { kind: 'protected_user' }
  | { kind: 'duplicate_username' }
  | { kind: 'ok'; data: AdminCreatedUserRow };

export type AdminDeleteUserResult =
  | { kind: 'not_found' }
  | { kind: 'protected_user' }
  | { kind: 'ok' };

// AUTH-004: self-service password change outcome.
export type ChangePasswordResult =
  | { kind: 'not_found' }
  | { kind: 'wrong_password' }
  | { kind: 'ok' };

// AUTH-004: admin-set password reset outcome.
export type AdminResetPasswordResult =
  | { kind: 'not_found' }
  | { kind: 'protected_user' }
  | { kind: 'ok' };

export interface BatchUserBuildInput {
  prefix: string;
  count: number;
  saltRounds: number;
  passwordLength: number;
}

// ---------------------------------------------------------------------------
// adminSystemService
// ---------------------------------------------------------------------------

export type DatabaseImportExecutable = 'psql' | 'pg_restore';

export interface DatabaseImportExecution {
  kind: 'ok';
  /** 'plain': psql reads the guarded dump on stdin; 'archive': pg_restore reads the file. */
  format: 'plain' | 'archive';
  executable: DatabaseImportExecutable;
  args: string[];
  env: NodeJS.ProcessEnv | Record<string, string>;
}

export type BuildDatabaseImportCommandResult =
  | DatabaseImportExecution
  | { kind: 'unsupported_extension' };

export interface DatabaseExportExecution {
  kind: 'ok';
  executable: 'pg_dump';
  args: string[];
  env: NodeJS.ProcessEnv | Record<string, string>;
}

export type BuildDatabaseExportCommandResult = DatabaseExportExecution;

export type CreateBatchUsersResult =
  | { kind: 'duplicate_username'; username: string }
  | { kind: 'ok'; users: Array<{ username: string; password: string }> };

export interface RegistrationSettingRow extends Pick<SystemSettingRow, 'setting_value'> {}

// ---------------------------------------------------------------------------
// contestQueryService
// ---------------------------------------------------------------------------

export interface ContestListRow {
  id: number;
  title: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  status: string;
  created_at: Date;
  is_visible: boolean;
  participant_count: string;
  is_participant: boolean;
  problem_count: string;
}

export interface ContestProblemsSummaryRow extends IdTitlePair {
  author: string | null;
}

export interface ContestScoreboardRow {
  user_id: number;
  username: string;
  has_avatar?: boolean;
  total_score: number;
  /** Snapshots taken before B9 hold bare numbers or { score } only. */
  detailed_scores: Record<string, number> | Record<string, ContestProblemStanding>;
  last_score_improvement_time?: Date | null;
  /** Competition rank (running, finishing, finished); absent before the start. */
  rank?: number;
}

/** One participant's result on one contest problem (B9). */
export interface ContestProblemStanding {
  score: number;
  attempts?: number;
  /** When the best score was first reached. */
  best_at?: string;
  /** Per-case statuses of that best submission. */
  statuses?: string[];
}

export interface ContestScoreboardResponse {
  scoreboard: ContestScoreboardRow[];
  problems: Array<{ problem_id: string; title: string }>;
  status: ContestStatus;
  start_time: Date;
}

export interface ContestWritePayload {
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
}

export interface ContestProblemStatsRow extends ContestProblemsSummaryRow {
  time_limit_ms?: number;
  memory_limit_mb?: number;
  best_score: number | null;
  submission_count: string | null;
  latest_submission_at: Date | null;
  latest_submission_status: string | null;
  best_submission_status: string | null;
  best_submission_results: unknown;
}

export interface ContestProblemDetailRow extends ContestProblemsSummaryRow {
  time_limit_ms: number;
  memory_limit_mb: number;
  has_pdf: boolean;
  problem_type: ProblemType;
  submission_filename: string | null;
  has_starter_files: boolean;
}

export type ContestProblemsForParticipantResult =
  | { kind: 'not_found' }
  | { kind: 'not_participant' }
  | { kind: 'inactive'; data: [] }
  | { kind: 'ok'; data: ContestProblemStatsRow[] };

export type ContestProblemDetailResult =
  | { kind: 'not_found_contest' }
  | { kind: 'not_participant' }
  | { kind: 'inactive' }
  | { kind: 'not_found_problem' }
  | { kind: 'ok'; data: ContestProblemDetailRow };

export type ContestProblemPdfResult =
  | { kind: 'not_found_contest' }
  | { kind: 'not_participant' }
  | { kind: 'inactive' }
  | { kind: 'not_found_pdf' }
  | { kind: 'ok'; data: Buffer };

export type ContestProblemStarterResult =
  | { kind: 'not_found_contest' }
  | { kind: 'not_participant' }
  | { kind: 'inactive' }
  | { kind: 'not_found_starter' }
  | { kind: 'ok'; files: ProblemFileInput[] };

export type MoveSingleProblemToMainResult =
  | { kind: 'not_found_contest' }
  | { kind: 'invalid_status' }
  | { kind: 'not_found_problem' }
  | { kind: 'ok'; data: Pick<ProblemRow, 'id' | 'title'> };

// ---------------------------------------------------------------------------
// contestScheduler
// ---------------------------------------------------------------------------

export interface ContestSchedulerStatus {
  isRunning: boolean;
  lastCheck: string;
  schedulerActive: boolean;
}

export interface ContestTimingRow extends Pick<ContestRow, 'id' | 'title' | 'start_time' | 'end_time'> {}
