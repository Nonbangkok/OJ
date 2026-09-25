/**
 * API-layer shapes that are not direct DB rows.
 * Covers request bodies, composite response payloads, and
 * callback parameter types used inside controllers.
 */
import { ProblemCategory, SubmissionLanguage } from '../constants';
import { ContestStatus, ProblemDetailDTO, UserPublicProfileDTO } from './models';

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export interface MessageResponse {
    message: string;
}

export interface ValidationErrorResponse {
    errors: unknown[];
}

export interface RegistrationStatusResponse {
    enabled: boolean;
}

export interface IdTitleResponse {
    id: string;
    title: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface RegisterRequestBody {
    username: string;
    password: string;
}

export interface LoginRequestBody {
    username: string;
    password: string;
}

export interface RegisterSuccessResponse {
    message: string;
    user: Pick<UserPublicProfileDTO, 'id' | 'username'>;
}

export interface LoginSuccessResponse {
    message: string;
    user: UserPublicProfileDTO;
}

export interface MeAuthenticatedResponse {
    isAuthenticated: true;
    user: UserPublicProfileDTO;
}

export interface MeUnauthenticatedResponse {
    isAuthenticated: false;
}

export type MeResponse = MeAuthenticatedResponse | MeUnauthenticatedResponse;

// ---------------------------------------------------------------------------
// Admin — Batch User Creation
// ---------------------------------------------------------------------------

/**
 * A single entry in the batch-user-creation response array.
 * Replaces the `any[]` typed `generatedUsers` in adminController.
 */
export interface BatchUserEntry {
    username: string;
    password: string;
}

export interface CreateAdminUserRequestBody extends RegisterRequestBody {
    role: UserPublicProfileDTO['role'];
}

export interface UpdateAdminUserRequestBody {
    username: string;
    role: UserPublicProfileDTO['role'];
}

export interface BatchCreateUsersRequestBody {
    prefix: string;
    count: number;
}

export interface BatchCreateUsersSuccessResponse {
    message: string;
    users: BatchUserEntry[];
}

export interface UpdateRegistrationSettingRequestBody {
    enabled: boolean;
}

// ---------------------------------------------------------------------------
// Admin rejudge
// ---------------------------------------------------------------------------

export interface RejudgeProblemParams {
    problemId: string;
}

export interface RejudgeContestParams {
    contestId: number;
}

export interface RejudgeResponse {
    /** Submissions accepted for rejudge (reset + enqueued). */
    queued: number;
    /** Non-judgeable rows excluded from the rejudge. */
    skipped: number;
    /** Rows excluded because a judge was already in flight for them (JUDGE-004). */
    busy?: number;
}

// ---------------------------------------------------------------------------
// Problem — Batch Upload Progress
// ---------------------------------------------------------------------------

/**
 * The shape of data emitted by `processBatchUpload`'s progress callback.
 * Extra keys are allowed via the index signature since the service may add
 * task-specific fields dynamically.
 */
export interface BatchUploadProgressData {
    status: string;
    message: string;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Problem — Export Config
// ---------------------------------------------------------------------------

/**
 * The `config.json` written inside each problem folder during export.
 */
export interface ProblemExportConfig {
    id: string;
    title: string;
    author: string | null;
    time_limit_ms: number;
    memory_limit_mb: number;
}

export interface CreateProblemRequestBody {
    id: string;
    title: string;
    author: string;
    categories?: readonly ProblemCategory[];
    /** Codeforces-like rating (800–3500 step 100); null = Unrated. */
    difficulty?: number | null;
    collection_id?: number | null;
    time_limit_ms: number;
    memory_limit_mb: number;
}

export interface UpdateProblemRequestBody {
    id: string;
    title?: string;
    author?: string;
    categories?: readonly ProblemCategory[];
    /** Codeforces-like rating (800–3500 step 100); null = Unrated. */
    difficulty?: number | null;
    collection_id?: number | null;
    time_limit_ms?: number;
    memory_limit_mb?: number;
}

export interface UpdateProblemVisibilityRequestBody {
    isVisible: boolean;
}

export interface ProblemExportRequestBody {
    problemIds: string[];
}

// ---------------------------------------------------------------------------
// Problem Authoring
// ---------------------------------------------------------------------------

export interface CreateAuthorProfileRequestBody {
    userId: number | null;
    akaName: string;
    realName: string;
    defaultLanguage: string;
    countryCode: string;
}

export type UpdateAuthorProfileRequestBody = Partial<CreateAuthorProfileRequestBody> & {
    removeProfileImage?: boolean;
    /** Resubmit with true after the client has confirmed the sync impact. */
    confirmed?: boolean;
};

/** Response when an author-relevant edit needs confirmation before it cascades. */
export interface AuthorProfileUpdateConfirmationResponse {
    confirmationRequired: true;
    affectedDrafts: number;
    affectedPublishedProblems: number;
    profile: {
        id: string;
        userId: number | null;
        akaName: string;
        realName: string;
        defaultLanguage: string;
        countryCode: string;
        hasProfileImage: boolean;
        createdAt: Date;
        updatedAt: Date;
    };
}

export interface CreateProblemDraftRequestBody {
    problemId: string;
    title: string;
    authorProfileId: string | null;
    authorAkaName?: string;
    authorRealName?: string;
    language?: string;
    countryCode?: string;
    categories?: readonly ProblemCategory[];
    /** Codeforces-like rating (800–3500 step 100); null = Unrated. */
    difficulty?: number | null;
    timeLimitMs: number;
    memoryLimitMb: number;
    statementHtml: string;
    solutionCpp: string;
    generatorCpp: string | null;
    templateVersion: string;
}

export type UpdateProblemDraftRequestBody = {
    expectedRevision: number;
} & Partial<CreateProblemDraftRequestBody>;

export interface RefreshProblemDraftAuthorRequestBody {
    expectedRevision: number;
}

export interface CreateStatementAssetRequestBody {
    expectedRevision: number;
    filename?: string;
}

export interface DeleteStatementAssetQuery {
    expectedRevision: string;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitRequestBody {
    problemId: string;
    language: SubmissionLanguage;
    code: string;
    contestId?: string;
}

export interface SubmitSuccessResponse {
    message: string;
    submissionId: number;
    isContestSubmission: boolean;
}

export interface SubmissionListQuery {
    filter?: string;
    problemId?: string;
    contestId?: string;
    filterProblemId?: string;
    filterUserId?: string;
}

export interface SearchQuery {
    q?: string;
    contestId?: string;
}

// ---------------------------------------------------------------------------
// Contest
// ---------------------------------------------------------------------------

export interface ContestCreateRequestBody {
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
}

export interface ContestUpdateRequestBody extends ContestCreateRequestBody {}

export interface ContestDetailResponse {
    id: number;
    title: string;
    description: string | null;
    start_time: Date;
    end_time: Date;
    status: ContestStatus;
    created_at: Date;
    created_by: number | null;
    participant_count: string;
    created_by_username: string | null;
    problems: Array<Pick<ProblemDetailDTO, 'id' | 'title' | 'author'>>;
    is_participant: boolean;
}

export interface MoveContestProblemsRequestBody {
    problemIds: string[];
    action: 'move_to_contest' | 'move_to_main';
}
