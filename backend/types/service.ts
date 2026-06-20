import { Readable } from 'stream';
import { UPLOAD_STATUS } from '../constants';
import { ContestRow, ProblemRow, SystemSettingRow, TestcaseRow, UserRow } from './models';

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

export interface ProblemConfig {
  id: string;
  title: string;
  author: string;
  time_limit_ms: number;
  memory_limit_mb: number;
}

export interface BatchUploadResult {
  added: string[];
  skipped: string[];
  errors: Array<{ directory: string; message: string }>;
}

export type BufferedContent = Buffer | Readable;

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

export interface SubmissionListRow {
  id: number;
  username: string;
  problem_id: string;
  problem_title: string;
  overall_status: string;
  score: number;
  language: string;
  submitted_at: Date;
}

export interface SearchUserRow {
  username: string;
}

export interface GlobalScoreboardRow {
  username: string;
  total_score: string;
  problems_solved: string;
  last_score_improvement_time: Date | null;
}

export interface ProblemStatsRow {
  id: string;
  title: string;
  author: string | null;
  best_score: number | null;
  submission_count: string | null;
  latest_submission_at: Date | null;
  latest_submission_status: string | null;
  best_submission_status: string | null;
  best_submission_results: unknown;
}

// ---------------------------------------------------------------------------
// problemQueryService
// ---------------------------------------------------------------------------

export interface ProblemExportTestcaseRow extends Pick<TestcaseRow, 'case_number' | 'input_data' | 'output_data'> {}

export interface ProblemExportBundle {
  problem: Pick<ProblemRow, 'id' | 'title' | 'author' | 'time_limit_ms' | 'memory_limit_mb' | 'problem_pdf'>;
  testcases: ProblemExportTestcaseRow[];
}

export type ReplaceProblemTestcasesFromZipResult =
  | { kind: 'no_valid_pairs' }
  | { kind: 'ok'; insertedCount: number };

// ---------------------------------------------------------------------------
// adminQueryService
// ---------------------------------------------------------------------------

export interface AdminUserListRow extends Pick<UserRow, 'id' | 'username' | 'role' | 'created_at'> {}

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
  executable: DatabaseImportExecutable;
  args: string[];
  env: NodeJS.ProcessEnv | Record<string, string>;
}

export type BuildDatabaseImportCommandResult =
  | DatabaseImportExecution
  | { kind: 'unsupported_extension' };

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
  total_score: number;
  detailed_scores: Record<string, number> | Record<string, { score: number }>;
  last_score_improvement_time?: Date | null;
}

export interface ContestScoreboardResponse {
  scoreboard: ContestScoreboardRow[];
  problems: Array<{ problem_id: string; title: string }>;
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
