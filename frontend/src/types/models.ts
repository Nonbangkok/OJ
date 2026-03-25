export type UserRole = 'user' | 'staff' | 'admin';

export type ContestStatus = 'scheduled' | 'running' | 'finishing' | 'finished';

export type SubmissionStatus =
  | 'Pending'
  | 'Compiling'
  | 'Running'
  | 'Accepted'
  | 'Wrong Answer'
  | 'Time Limit Exceeded'
  | 'Runtime Error'
  | 'Memory Limit Exceeded'
  | 'Compilation Error'
  | 'Skipped';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
}

export interface ProblemSuggestion {
  id: string;
  title: string;
}

export interface UserSuggestion {
  username: string;
}

export interface TestCaseResult {
  testCase: number;
  status: string;
  timeMs?: number;
  memoryKb?: number;
  output?: string;
}

export interface ProblemBase {
  id: string;
  title: string;
  author: string | null;
}

export interface ContestProblem extends ProblemBase {
  problem_id?: string;
}

export interface ProblemSummary extends ProblemBase {
  best_score?: number | null;
  submission_count?: string | null;
  latest_submission_at?: string | null;
  latest_submission_status?: string | null;
  best_submission_status?: string | null;
  best_submission_results?: TestCaseResult[] | null;
  is_visible?: boolean;
  contest_id?: number | null;
  contest_status?: ContestStatus | null;
}

export interface ProblemDetail extends ProblemBase {
  time_limit_ms: number;
  memory_limit_mb: number;
  has_pdf?: boolean;
  is_visible?: boolean;
}

export interface Contest extends Record<string, unknown> {
  id: number;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  status: ContestStatus;
  created_at?: string;
  created_by?: number | null;
  participant_count?: string;
  created_by_username?: string | null;
  problems?: ProblemBase[];
  is_participant?: boolean;
}

export interface SubmissionSummary {
  id: number;
  username: string;
  problem_id: string;
  problem_title?: string;
  overall_status: string;
  score: number;
  language: string;
  submitted_at: string;
}

export interface SubmissionDetail extends SubmissionSummary {
  code: string;
  max_time_ms: number | null;
  max_memory_kb: number | null;
  results: TestCaseResult[] | null;
  problem_name?: string;
}

export interface GlobalScoreboardEntry {
  username: string;
  total_score: number | string;
  problems_solved: number | string;
  last_score_improvement_time?: string | null;
}

export interface ContestProblemScore {
  score: number;
  attempts: number;
  solved: boolean;
}

export type ContestDetailedScore = Record<string, number | ContestProblemScore>;

export interface ContestScoreboardEntry {
  user_id?: number | string;
  username: string;
  total_score: number;
  detailed_scores: ContestDetailedScore;
  last_score_improvement_time: string | null;
}

export interface ContestScoreboardPayload {
  scoreboard: ContestScoreboardEntry[];
  problems: ContestProblem[];
}

export interface RegistrationSettings {
  enabled: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  role: UserRole;
  created_at?: string;
}

export interface BatchCreatedUser {
  username: string;
  password: string;
}

export interface AdminProblem extends ProblemBase {
  is_visible: boolean;
  contest_id: number | null;
  contest_status: ContestStatus | null;
}

export interface UploadProgress {
  status: string;
  message: string;
  processed?: number;
  total?: number;
  currentProblem?: string;
  added?: string[];
  skipped?: string[];
  errors?: Array<{ directory: string; message: string }>;
}
