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
  ProblemSummary,
  RegistrationSettings,
  PasswordChangeSettings,
  SubmissionDetail,
  SubmissionSummary,
  UploadProgress,
  UserSuggestion,
  SiteConfig,
} from './models';

export interface ApiMessageResponse {
  message: string;
}

export interface JobStartResponse extends ApiMessageResponse {
  jobId?: string;
  token?: string;
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

export type ProblemsWithStatsResponse = ProblemSummary[];
/** One page of the problem list (GET /problems-with-stats). */
export interface ProblemsWithStatsPageResponse {
  problems: ProblemSummary[];
  /** Opaque token for the next page; null when this is the last page. */
  nextCursor: string | null;
  hasMore: boolean;
}
/** Global category tab counts for the public problem list. */
export interface ProblemCategoryCountsResponse {
  categories: Array<{ name: string; count: number }>;
  uncategorized: number;
  total: number;
}
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

/** Paged admin user list (ADMIN-008): rows + total count + paging echo. */
export interface AdminUsersPageResponse {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}
export type AdminAuthorsResponse = Array<Pick<AdminUser, 'id' | 'username'>>;
export type AdminCreateUserResponse = AdminUser;
export type AdminUpdateUserResponse = AdminUser;

export interface BatchCreateUsersResponse extends ApiMessageResponse {
  users: BatchCreatedUser[];
}

export type AdminProblemsResponse = AdminProblem[];
export type AdminProblemDetailResponse = ProblemDetail;

// --- Admin testcase viewer (GET /admin/problems/:id/testcases) -----------

/** Metadata row of the default (list) response — never carries content. */
export interface TestcaseMetadataResponse {
  case_number: number;
  input_bytes: number;
  output_bytes: number;
}

export interface TestcaseListResponse {
  testcases: TestcaseMetadataResponse[];
  total: number;
}

/** One side (input or output) of a single fetched case. */
export interface TestcaseViewPart {
  /** True content size in bytes (before API truncation). */
  bytes: number;
  truncated: boolean;
  content: string;
}

export interface TestcaseViewResponse {
  caseNumber: number;
  input: TestcaseViewPart;
  output: TestcaseViewPart;
}

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

export type PasswordChangeSettingsResponse = PasswordChangeSettings;

export type SiteConfigResponse = SiteConfig;

export interface SiteAccessModeUpdateResponse extends ApiMessageResponse {
  accessMode: 'public' | 'private';
}

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

export interface RejudgeResponse {
  /** Submissions accepted for rejudge (reset + enqueued). */
  queued: number;
  /** Non-judgeable rows excluded from the rejudge. */
  skipped: number;
  /** Rows excluded because a judge was already in flight for them. */
  busy?: number;
}
