import { z } from 'zod';
import { PROBLEM_VALIDATION, USER_ROLES, USER_VALIDATION } from '../constants';

const nonEmptyString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().optional();
const dateTimeString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid datetime format',
});

// Common schemas
export const idParamSchema = z.object({
  id: nonEmptyString,
});

// Auth schemas
export const registerSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH),
  password: z.string().min(USER_VALIDATION.MIN_PASSWORD_LENGTH),
});

export const loginSchema = z.object({
  username: nonEmptyString,
  password: nonEmptyString,
});

// Admin schemas
export const createAdminUserSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH),
  password: z.string().min(USER_VALIDATION.MIN_PASSWORD_LENGTH),
  role: z.enum([USER_ROLES.USER, USER_ROLES.STAFF]),
});

export const updateAdminUserSchema = z.object({
  username: z.string().trim().min(USER_VALIDATION.MIN_USERNAME_LENGTH),
  role: z.enum([USER_ROLES.USER, USER_ROLES.STAFF, USER_ROLES.ADMIN]),
});

export const batchCreateUsersSchema = z.object({
  prefix: nonEmptyString,
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
  title: nonEmptyString,
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
  title: z.string().trim().min(PROBLEM_VALIDATION.MIN_TITLE_LENGTH),
  author: z.string().trim().min(PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH),
  time_limit_ms: z.number().int().min(PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS),
  memory_limit_mb: z.number().int().min(PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB),
});

export const updateProblemSchema = z.object({
  id: nonEmptyString,
  title: z.string().trim().min(PROBLEM_VALIDATION.MIN_TITLE_LENGTH).optional(),
  author: z.string().trim().min(PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH).optional(),
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

// Submission schemas
export const submitSchema = z.object({
  problemId: nonEmptyString,
  language: nonEmptyString,
  code: nonEmptyString,
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
