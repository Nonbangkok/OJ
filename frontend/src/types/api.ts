import type {
  AdminProblem,
  AdminUser,
  AuthUser,
  BatchCreatedUser,
  Contest,
  ContestScoreboardPayload,
  GlobalScoreboardEntry,
  ProblemBase,
  ProblemDetail,
  ProblemSuggestion,
  RegistrationSettings,
  SubmissionDetail,
  SubmissionSummary,
  UploadProgress,
  UserSuggestion,
} from './models';

export interface ApiMessageResponse {
  message: string;
}

export interface JobStartResponse extends ApiMessageResponse {
  jobId?: string;
}

export interface MeAuthenticatedResponse {
  isAuthenticated: true;
  user: AuthUser;
}

export interface MeUnauthenticatedResponse {
  isAuthenticated: false;
}

export type MeResponse = MeAuthenticatedResponse | MeUnauthenticatedResponse;

export interface LoginResponse extends ApiMessageResponse {
  user: AuthUser;
}

export interface RegisterResponse extends ApiMessageResponse {
  user: Pick<AuthUser, 'id' | 'username'>;
}

export type ProblemsWithStatsResponse = ProblemDetail[];
export type ProblemDetailResponse = ProblemDetail;
export type ContestProblemDetailResponse = ProblemDetail;

export type ContestListResponse = Contest[];
export type ContestDetailResponse = Contest;
export type ContestProblemsResponse = ProblemBase[];
export type ContestScoreboardResponse = ContestScoreboardPayload;

export interface SubmitResponse extends ApiMessageResponse {
  submissionId: number;
  isContestSubmission: boolean;
}

export type SubmissionsResponse = SubmissionSummary[];
export type SubmissionDetailResponse = SubmissionDetail;
export type ProblemSearchResponse = ProblemSuggestion[];
export type UserSearchResponse = UserSuggestion[];

export type GlobalScoreboardResponse = GlobalScoreboardEntry[];

export type AdminUsersResponse = AdminUser[];
export type AdminAuthorsResponse = Array<Pick<AdminUser, 'id' | 'username'>>;
export type AdminCreateUserResponse = AdminUser;
export type AdminUpdateUserResponse = AdminUser;

export interface BatchCreateUsersResponse extends ApiMessageResponse {
  users: BatchCreatedUser[];
}

export type AdminProblemsResponse = AdminProblem[];
export type AdminProblemDetailResponse = ProblemDetail;

export interface ProblemExportResponse extends ApiMessageResponse {
  data?: Blob;
}

export interface BatchUploadStartResponse {
  progressId?: string;
  added?: string[];
  skipped?: string[];
  errors?: Array<{ directory: string; message: string }>;
}

export type UploadProgressResponse = UploadProgress;

export type RegistrationSettingsResponse = RegistrationSettings;

export interface RegistrationSettingsUpdateResponse extends ApiMessageResponse {
  enabled: boolean;
}

export interface ContestMutationResponse extends ApiMessageResponse {
  contest?: Contest;
}

export interface ProblemMutationResponse extends ApiMessageResponse {
  id?: string;
}

export interface ContestProblemsMutationResponse extends ApiMessageResponse {
  movedProblems?: ProblemBase[];
}
