/**
 * API-layer shapes that are not direct DB rows.
 * Covers request bodies, composite response payloads, and
 * callback parameter types used inside controllers.
 */
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
    time_limit_ms: number;
    memory_limit_mb: number;
}

export interface UpdateProblemRequestBody extends CreateProblemRequestBody {}

export interface UpdateProblemVisibilityRequestBody {
    isVisible: boolean;
}

export interface ProblemExportRequestBody {
    problemIds: string[];
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitRequestBody {
    problemId: string;
    language: string;
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
