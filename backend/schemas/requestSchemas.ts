import { z } from 'zod';
import { seedSchema } from '../authoring/protocol';
import {
  AUTHORING_VALIDATION,
  PROBLEM_VALIDATION,
  STATEMENT_ASSET,
  STRING_LIMITS,
  SUBMISSION_VALIDATION,
  USER_ROLES,
  USER_VALIDATION,
} from '../constants';

const nonEmptyString = z.string().trim().min(1);
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
export const idParamSchema = z.object({
  id: nonEmptyString,
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

// Admin schemas
export const createAdminUserSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH).max(STRING_LIMITS.USERNAME),
  password: z.string().min(USER_VALIDATION.MIN_PASSWORD_LENGTH).max(STRING_LIMITS.PASSWORD),
  role: z.enum([USER_ROLES.USER, USER_ROLES.STAFF]),
});

export const updateAdminUserSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH).max(STRING_LIMITS.USERNAME),
  role: z.enum([USER_ROLES.USER, USER_ROLES.STAFF, USER_ROLES.ADMIN]),
});

export const batchCreateUsersSchema = z.object({
  prefix: nonEmptyString.max(STRING_LIMITS.PREFIX),
  count: z.number().int().min(1).max(USER_VALIDATION.BATCH_MAX_COUNT),
});

export const updateRegistrationSettingSchema = z.object({
  enabled: z.boolean(),
});

// Contest schemas
export const contestIdParamSchema = idParamSchema;

export const contestProblemParamsSchema = z.object({
  id: nonEmptyString,
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
  time_limit_ms: z.number().int().min(PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS),
  memory_limit_mb: z.number().int().min(PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB),
});

export const updateProblemSchema = z.object({
  id: nonEmptyString,
  title: z.string().trim().min(PROBLEM_VALIDATION.MIN_TITLE_LENGTH).max(STRING_LIMITS.TITLE).optional(),
  author: z.string().trim().min(PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH).max(STRING_LIMITS.AUTHOR).optional(),
  time_limit_ms: z.number().int().min(PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS).optional(),
  memory_limit_mb: z.number().int().min(PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB).optional(),
});

export const updateProblemVisibilitySchema = z.object({
  isVisible: z.boolean(),
});

export const progressIdParamSchema = z.object({
  progressId: nonEmptyString,
});

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
}).strict();

const editableProblemDraftFields = {
  problemId: nonEmptyString.max(AUTHORING_VALIDATION.MAX_PROBLEM_ID_LENGTH),
  title: nonEmptyString.max(AUTHORING_VALIDATION.MAX_TITLE_LENGTH),
  authorProfileId: z.string().uuid().nullable(),
  authorAkaName: nonEmptyString.max(AUTHORING_VALIDATION.MAX_AKA_NAME_LENGTH),
  authorRealName: nonEmptyString.max(AUTHORING_VALIDATION.MAX_REAL_NAME_LENGTH),
  language: nonEmptyString.max(AUTHORING_VALIDATION.MAX_LANGUAGE_LENGTH),
  countryCode: z.string().regex(/^[A-Z]{3}$/),
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
export const submitSchema = z.object({
  problemId: nonEmptyString,
  language: nonEmptyString,
  code: nonEmptyString.max(SUBMISSION_VALIDATION.MAX_CODE_LENGTH),
  contestId: nonEmptyString.optional(),
});

export const submissionsQuerySchema = z.object({
  filter: optionalTrimmedString,
  problemId: optionalTrimmedString,
  contestId: optionalTrimmedString,
  filterProblemId: optionalTrimmedString,
  filterUserId: optionalTrimmedString,
});

export const searchQuerySchema = z.object({
  q: optionalTrimmedString,
  contestId: optionalTrimmedString,
});

export const submissionDetailQuerySchema = z.object({
  contestId: optionalTrimmedString,
});
