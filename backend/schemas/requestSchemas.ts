import { z } from 'zod';
import { seedSchema } from '../authoring/protocol';
import {
  ADMIN_USER_LIST_CONFIG,
  AUTHORING_VALIDATION,
  PROBLEM_CATEGORIES,
  PROBLEM_DIFFICULTY_MAX,
  PROBLEM_DIFFICULTY_MIN,
  PROBLEM_DIFFICULTY_STEP,
  PROBLEM_LIST_CONFIG,
  PROBLEM_VALIDATION,
  STATEMENT_ASSET,
  STRING_LIMITS,
  SUBMISSION_QUERY_CONFIG,
  SUBMISSION_VALIDATION,
  SUPPORTED_LANGUAGES,
  USER_ROLES,
  USER_VALIDATION,
} from '../constants';

const nonEmptyString = z.string().trim().min(1);
// Categories must come from the fixed list. An empty array means
// uncategorized. Deduplicated and sorted on the way in so equal sets always
// compare equal (the publish provenance guard relies on that).
const problemCategories = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return [];
    if (typeof value === 'string') return value === '' ? [] : [value];
    if (Array.isArray(value)) return [...new Set(value)].sort();
    return value;
  },
  z.array(z.enum(PROBLEM_CATEGORIES)),
);
// Difficulty on the 800–3500 step-100 scale, or null/undefined (Unrated).
const problemDifficulty = z.number().int()
  .min(PROBLEM_DIFFICULTY_MIN)
  .max(PROBLEM_DIFFICULTY_MAX)
  .refine((value) => value % PROBLEM_DIFFICULTY_STEP === 0, {
    message: `difficulty must be a multiple of ${PROBLEM_DIFFICULTY_STEP}`,
  })
  .nullable()
  .optional();
export const expectedRevisionSchema = z.object({
  expectedRevision: z.number().int().positive().max(2147483647),
}).strict();
export const generateAuthoringJobSchema = z.object({
  expectedRevision: z.number().int().positive().max(2147483647),
  seed: seedSchema,
}).strict();
const optionalTrimmedString = z.string().trim().optional();
const dateTimeString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid datetime format',
});
const authoringSource = z.string().refine(
  (value) => Buffer.byteLength(value, 'utf8') <= AUTHORING_VALIDATION.MAX_SOURCE_BYTES,
  { message: `Content must not exceed ${AUTHORING_VALIDATION.MAX_SOURCE_BYTES} UTF-8 bytes` },
);
const parseOptionalInteger = (value: unknown): unknown => {
  if (value === '' || value === 'null') {
    return null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }
  return value;
};
const optionalBooleanFromForm = z.preprocess(
  (value) => value === 'true' ? true : value === 'false' ? false : value,
  z.boolean().optional(),
);
const positiveIntegerFromForm = z.preprocess(
  (value) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive(),
);

// Common schemas
// :id params for the users/submissions/contests tables (SERIAL ids). A
// non-numeric id previously reached Postgres as-is and blew up as a 500
// cast error (SUB-003); rejecting it here returns a 400 before any query.
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// :id params for problem routes — problems use VARCHAR(50) string ids
// (e.g. "aplusb"), so this stays a string schema.
export const problemIdParamSchema = z.object({
  id: nonEmptyString.max(50),
});

export const usernameParamSchema = z.object({
  username: nonEmptyString.max(STRING_LIMITS.USERNAME),
});

// Auth schemas
export const registerSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH).max(STRING_LIMITS.USERNAME),
  password: z.string().min(USER_VALIDATION.MIN_PASSWORD_LENGTH).max(STRING_LIMITS.PASSWORD),
});

export const loginSchema = z.object({
  username: nonEmptyString.max(STRING_LIMITS.USERNAME),
  password: nonEmptyString.max(STRING_LIMITS.PASSWORD),
});

// AUTH-004: self-service password change. The current password is verified
// against the stored bcrypt hash before the new one is accepted; the new
// password carries the same policy as registration.
export const changePasswordSchema = z.object({
  currentPassword: nonEmptyString.max(STRING_LIMITS.PASSWORD),
  newPassword: z.string().min(USER_VALIDATION.MIN_PASSWORD_LENGTH).max(STRING_LIMITS.PASSWORD),
});

// AUTH-004: admin-set password reset — the admin supplies the new password
// directly (no email infrastructure exists for a temp-password flow).
export const adminResetUserPasswordSchema = z.object({
  newPassword: z.string().min(USER_VALIDATION.MIN_PASSWORD_LENGTH).max(STRING_LIMITS.PASSWORD),
});

// Admin schemas
// The create endpoint sits behind requireAdmin, so allowing role 'admin'
// here (mirroring updateAdminUserSchema) does not widen the authorization
// surface — an admin can already grant admin via the update route.
export const createAdminUserSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH).max(STRING_LIMITS.USERNAME),
  password: z.string().min(USER_VALIDATION.MIN_PASSWORD_LENGTH).max(STRING_LIMITS.PASSWORD),
  role: z.enum([USER_ROLES.USER, USER_ROLES.STAFF, USER_ROLES.ADMIN]),
});

export const updateAdminUserSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH).max(STRING_LIMITS.USERNAME),
  role: z.enum([USER_ROLES.USER, USER_ROLES.STAFF, USER_ROLES.ADMIN]),
});

// ADMIN-008: paged admin user list. Defaults keep page 1 at the default limit.
export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(ADMIN_USER_LIST_CONFIG.MAX_LIMIT)
    .default(ADMIN_USER_LIST_CONFIG.DEFAULT_LIMIT),
}).strict();

export const batchCreateUsersSchema = z.object({
  prefix: nonEmptyString.max(STRING_LIMITS.PREFIX),
  count: z.number().int().min(1).max(USER_VALIDATION.BATCH_MAX_COUNT),
});

export const updateRegistrationSettingSchema = z.object({
  enabled: z.boolean(),
});

export const updatePasswordChangeSettingSchema = z.object({
  enabled: z.boolean(),
});

export const updateSiteAccessModeSchema = z.object({
  accessMode: z.enum(['public', 'private']),
});

// Contest schemas
export const contestIdParamSchema = idParamSchema;

export const contestProblemParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  problemId: nonEmptyString,
});

export const contestBodySchema = z.object({
  title: nonEmptyString.max(STRING_LIMITS.TITLE),
  description: optionalTrimmedString,
  startTime: dateTimeString,
  endTime: dateTimeString,
});

export const moveContestProblemsBodySchema = z.object({
  problemIds: z.array(nonEmptyString).min(1),
  action: z.enum(['move_to_contest', 'move_to_main']),
});

// Problem schemas
export const createProblemSchema = z.object({
  id: nonEmptyString,
  title: z.string().trim().min(PROBLEM_VALIDATION.MIN_TITLE_LENGTH).max(STRING_LIMITS.TITLE),
  author: z.string().trim().min(PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH).max(STRING_LIMITS.AUTHOR),
  categories: problemCategories.optional(),
  difficulty: problemDifficulty,
  collection_id: z.number().int().positive().nullable().optional(),
  time_limit_ms: z.number().int().min(PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS),
  memory_limit_mb: z.number().int().min(PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB),
});

export const updateProblemSchema = z.object({
  id: nonEmptyString,
  title: z.string().trim().min(PROBLEM_VALIDATION.MIN_TITLE_LENGTH).max(STRING_LIMITS.TITLE).optional(),
  author: z.string().trim().min(PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH).max(STRING_LIMITS.AUTHOR).optional(),
  categories: problemCategories.optional(),
  difficulty: problemDifficulty,
  collection_id: z.number().int().positive().nullable().optional(),
  time_limit_ms: z.number().int().min(PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS).optional(),
  memory_limit_mb: z.number().int().min(PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB).optional(),
});

export const updateProblemVisibilitySchema = z.object({
  isVisible: z.boolean(),
});

export const updateContestVisibilitySchema = z.object({
  isVisible: z.boolean(),
}).strict();

// Problem Collections (organizational groups, distinct from categories)
const collectionName = z.string().trim().min(1).max(100);
/** Optional free-text blurb; empty/whitespace-only normalizes to null. */
const collectionDescription = z.string().trim().max(500).optional().nullable();

export const createCollectionSchema = z.object({
  name: collectionName,
  description: collectionDescription,
});

export const updateCollectionSchema = z.object({
  name: collectionName,
  description: collectionDescription,
}).strict();

export const collectionIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

export const collectionVisibilityBodySchema = z.object({
  isVisible: z.boolean(),
}).strict();

/**
 * Difficulty filtering/sorting plus keyset pagination for the user-facing
 * problem list (/problems-with-stats). difficultyMin/Max are inclusive and
 * exclude Unrated (NULL) problems; sort=difficulty puts NULLs last in both
 * directions. `search` matches id/title (ILIKE, server-side); `category`
 * filters by one category from the closed list, or the literal
 * 'Uncategorized' for problems with no categories. `cursor` is the opaque
 * next-page token returned by the previous response — it encodes the last
 * row's sort key and is only valid for the same sort/order.
 */
const difficultyBound = z.coerce.number().int()
  .min(PROBLEM_DIFFICULTY_MIN)
  .max(PROBLEM_DIFFICULTY_MAX)
  .refine((value) => value % PROBLEM_DIFFICULTY_STEP === 0, {
    message: `difficulty bound must be a multiple of ${PROBLEM_DIFFICULTY_STEP}`,
  });
export const problemsWithStatsQuerySchema = z.object({
  difficultyMin: difficultyBound.optional(),
  difficultyMax: difficultyBound.optional(),
  sort: z.enum(['difficulty']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  search: z.string().trim().max(STRING_LIMITS.TITLE).optional(),
  category: z.enum(['Uncategorized', ...PROBLEM_CATEGORIES] as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(PROBLEM_LIST_CONFIG.MAX_LIMIT).optional(),
  cursor: z.string().min(1).max(2048).optional(),
}).refine(
  ({ difficultyMin, difficultyMax }) =>
    difficultyMin === undefined || difficultyMax === undefined || difficultyMin <= difficultyMax,
  { message: 'difficultyMin must not exceed difficultyMax' },
).refine(
  ({ sort, order }) => order === undefined || sort !== undefined,
  { message: 'order requires sort' },
);

export const progressIdParamSchema = z.object({
  progressId: nonEmptyString,
});

/**
 * Single-case selection for the admin testcase viewer
 * (GET /admin/problems/:id/testcases). Absent => metadata-only list;
 * present => one full case (subject to TESTCASE_VIEWER_CONFIG truncation).
 */
export const problemTestcasesQuerySchema = z.object({
  caseNumber: z.coerce.number().int().positive().optional(),
}).strict();

export const problemExportSchema = z.object({
  problemIds: z.array(nonEmptyString).min(1),
});

// Problem Authoring schemas
export const problemDraftIdParamSchema = z.object({
  id: z.string().uuid(),
}).strict();

export const authorProfileIdParamSchema = problemDraftIdParamSchema;

export const compileAuthoringJobSchema = z.object({
  expectedRevision: z.number().int().positive().max(AUTHORING_VALIDATION.MAX_INT),
  target: z.enum(['solution', 'generator']).default('solution'),
}).strict();

export const draftAssetParamsSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
}).strict();

const authorProfileFields = {
  userId: z.preprocess(
    parseOptionalInteger,
    z.number().int().positive().nullable(),
  ),
  akaName: nonEmptyString.max(AUTHORING_VALIDATION.MAX_AKA_NAME_LENGTH),
  realName: nonEmptyString.max(AUTHORING_VALIDATION.MAX_REAL_NAME_LENGTH),
  defaultLanguage: nonEmptyString.max(AUTHORING_VALIDATION.MAX_LANGUAGE_LENGTH),
  countryCode: z.string().regex(/^[A-Z]{3}$/),
};

export const createAuthorProfileSchema = z.object({
  ...authorProfileFields,
  userId: authorProfileFields.userId.default(null),
}).strict();

export const updateAuthorProfileSchema = z.object({
  userId: z.preprocess(
    parseOptionalInteger,
    z.number().int().positive().nullable().optional(),
  ),
  akaName: authorProfileFields.akaName.optional(),
  realName: authorProfileFields.realName.optional(),
  defaultLanguage: authorProfileFields.defaultLanguage.optional(),
  countryCode: authorProfileFields.countryCode.optional(),
  removeProfileImage: optionalBooleanFromForm,
  // Confirmation gate for the profile auto-sync cascade: set after the client
  // has shown the affected-draft/published-problem counts to the admin.
  confirmed: optionalBooleanFromForm,
}).strict();

const editableProblemDraftFields = {
  problemId: nonEmptyString.max(AUTHORING_VALIDATION.MAX_PROBLEM_ID_LENGTH),
  title: nonEmptyString.max(AUTHORING_VALIDATION.MAX_TITLE_LENGTH),
  authorProfileId: z.string().uuid().nullable(),
  authorAkaName: nonEmptyString.max(AUTHORING_VALIDATION.MAX_AKA_NAME_LENGTH),
  authorRealName: nonEmptyString.max(AUTHORING_VALIDATION.MAX_REAL_NAME_LENGTH),
  language: nonEmptyString.max(AUTHORING_VALIDATION.MAX_LANGUAGE_LENGTH),
  countryCode: z.string().regex(/^[A-Z]{3}$/),
  categories: problemCategories,
  difficulty: problemDifficulty,
  timeLimitMs: z.number().int().min(PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS)
    .max(AUTHORING_VALIDATION.MAX_INT),
  memoryLimitMb: z.number().int().min(PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB)
    .max(AUTHORING_VALIDATION.MAX_INT),
  statementHtml: authoringSource,
  solutionCpp: authoringSource,
  generatorCpp: authoringSource.nullable(),
  templateVersion: nonEmptyString.max(AUTHORING_VALIDATION.MAX_TEMPLATE_VERSION_LENGTH),
};

export const createProblemDraftSchema = z.object({
  ...editableProblemDraftFields,
  authorProfileId: editableProblemDraftFields.authorProfileId.default(null),
  authorAkaName: editableProblemDraftFields.authorAkaName.optional(),
  authorRealName: editableProblemDraftFields.authorRealName.optional(),
  language: editableProblemDraftFields.language.optional(),
  countryCode: editableProblemDraftFields.countryCode.optional(),
  categories: editableProblemDraftFields.categories.default([]),
  difficulty: editableProblemDraftFields.difficulty.default(null),
  statementHtml: editableProblemDraftFields.statementHtml.default(''),
  solutionCpp: editableProblemDraftFields.solutionCpp.default(''),
  generatorCpp: editableProblemDraftFields.generatorCpp.default(null),
  templateVersion: editableProblemDraftFields.templateVersion.default('red-gate-v1'),
}).strict().superRefine((value, context) => {
  if (value.authorProfileId !== null) {
    return;
  }
  for (const field of ['authorAkaName', 'authorRealName', 'language', 'countryCode'] as const) {
    if (value[field] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required when no author profile is selected`,
      });
    }
  }
});

export const refreshProblemDraftAuthorSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();

export const createStatementAssetSchema = z.object({
  expectedRevision: positiveIntegerFromForm,
  filename: nonEmptyString.max(STATEMENT_ASSET.MAX_FILENAME_LENGTH).optional(),
}).strict();

export const deleteStatementAssetQuerySchema = z.object({
  expectedRevision: positiveIntegerFromForm,
}).strict();

export const updateProblemDraftSchema = z.object({
  expectedRevision: z.number().int().positive(),
  problemId: editableProblemDraftFields.problemId.optional(),
  title: editableProblemDraftFields.title.optional(),
  authorProfileId: editableProblemDraftFields.authorProfileId.optional(),
  authorAkaName: editableProblemDraftFields.authorAkaName.optional(),
  authorRealName: editableProblemDraftFields.authorRealName.optional(),
  language: editableProblemDraftFields.language.optional(),
  countryCode: editableProblemDraftFields.countryCode.optional(),
  categories: editableProblemDraftFields.categories.optional(),
  difficulty: editableProblemDraftFields.difficulty.optional(),
  timeLimitMs: editableProblemDraftFields.timeLimitMs.optional(),
  memoryLimitMb: editableProblemDraftFields.memoryLimitMb.optional(),
  statementHtml: editableProblemDraftFields.statementHtml.optional(),
  solutionCpp: editableProblemDraftFields.solutionCpp.optional(),
  generatorCpp: editableProblemDraftFields.generatorCpp.optional(),
  templateVersion: editableProblemDraftFields.templateVersion.optional(),
}).strict().refine(
  ({ expectedRevision: _expectedRevision, ...updates }) => Object.keys(updates).length > 0,
  { message: 'At least one draft field must be provided' },
);

// Submission schemas
// Highest page requestable on the submissions list. Guards pathological
// offsets; combined with LIST_LIMIT this reaches the newest 100k submissions.
export const SUBMISSION_QUERY_PAGE_MAX = 500;

export const submitSchema = z.object({
  problemId: nonEmptyString,
  language: z.enum(SUPPORTED_LANGUAGES),
  code: nonEmptyString.max(SUBMISSION_VALIDATION.MAX_CODE_LENGTH),
  contestId: nonEmptyString.optional(),
});

export const submissionsQuerySchema = z.object({
  filter: optionalTrimmedString,
  problemId: optionalTrimmedString,
  contestId: optionalTrimmedString,
  filterProblemId: optionalTrimmedString,
  filterUserId: optionalTrimmedString,
  // SUB-004: page-based access past the hard 200-row cap. Page 1 (default)
  // is the previous behavior; the cap per page stays at LIST_LIMIT.
  page: z.coerce.number().int().min(1).max(SUBMISSION_QUERY_PAGE_MAX).default(1),
}).strict();

export const searchQuerySchema = z.object({
  q: optionalTrimmedString,
  contestId: optionalTrimmedString,
});

export const submissionDetailQuerySchema = z.object({
  contestId: optionalTrimmedString,
});

// Analytics schemas
// days: 7/30/90 windowed, or 0 for all-time.
export const ANALYTICS_ALL_TIME_DAYS = 0;

export const analyticsOverviewQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [0, 7, 30, 90].includes(d), {
    message: 'days must be 0, 7, 30, or 90',
  }).default(30),
});

export const analyticsUsersQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['username', 'submissions', 'solved', 'acRate', 'lastActive']).default('submissions'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const analyticsProblemsQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['title', 'category', 'submissions', 'accepted', 'acRate', 'solvers']).default('submissions'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const analyticsUserIdParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const analyticsProblemIdParamSchema = z.object({
  problemId: nonEmptyString.max(50),
});

export const analyticsContestIdParamSchema = z.object({
  contestId: z.coerce.number().int().positive(),
});

/** :id params that must be positive integers (contest similarity etc.). */
export const numericContestIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const analyticsSubmissionsQuerySchema = z.object({
  problemId: z.string().trim().max(50).optional(),
  userId: z.coerce.number().int().positive().optional(),
  verdict: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Retention (idle/never-submitted) analytics query. */
export const analyticsRetentionQuerySchema = z.object({
  idleDays: z.coerce.number().int().min(1).max(365).default(30),
});

/** Which analysis dataset a CSV export covers. */
export const analyticsExportKindSchema = z.enum(['users', 'problems', 'submissions']);

export const analyticsExportQuerySchema = z.object({
  type: analyticsExportKindSchema,
  search: z.string().trim().max(100).optional(),
  problemId: z.string().trim().max(50).optional(),
  userId: z.coerce.number().int().positive().optional(),
  verdict: z.string().trim().max(50).optional(),
  sortBy: z.string().trim().max(30).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});
