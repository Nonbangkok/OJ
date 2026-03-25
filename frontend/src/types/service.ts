import type { ContestStatus, UserRole } from './models';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface SubmitRequest {
  problemId: string;
  language: string;
  code: string;
  contestId?: string | number;
}

export interface SubmissionQueryParams {
  filter?: 'all' | 'mine';
  problemId?: string;
  contestId?: string | number;
  filterProblemId?: string;
  filterUserId?: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserRequest {
  username: string;
  role: UserRole;
}

export interface BatchCreateUsersRequest {
  prefix: string;
  count: number;
}

export interface CreateProblemRequest {
  id: string;
  title: string;
  author: string;
  time_limit_ms: number;
  memory_limit_mb: number;
}

export interface UpdateProblemRequest extends CreateProblemRequest {}

export interface CreateContestRequest {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
}

export interface UpdateContestRequest extends CreateContestRequest {}

export interface MigrateContestProblemsRequest {
  problemIds: string[];
  action: 'move_to_contest' | 'move_to_main';
}

export interface BatchUploadProblemError {
  directory: string;
  message: string;
}

export interface BatchUploadFeedback {
  visible: boolean;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface BatchUploadProgressState {
  visible: boolean;
  processed: number;
  total: number;
  message: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error' | '';
  currentProblem?: string;
  added?: string[];
  skipped?: string[];
  errors?: BatchUploadProblemError[];
}

export interface ProblemSelectionBulkConfirm {
  isOpen: boolean;
  type: 'show' | 'hide' | null;
}

export interface UploadProgressState {
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  message: string;
}

export type ContestStatusStyleMap = Record<ContestStatus, string>;
