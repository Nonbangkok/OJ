import { z } from 'zod';
import {
  AUTHORING_VALIDATION,
  PROBLEM_CATEGORIES,
  PROBLEM_DIFFICULTY_MAX,
  PROBLEM_DIFFICULTY_MIN,
  PROBLEM_DIFFICULTY_STEP,
  PROBLEM_VALIDATION,
  STRING_LIMITS,
} from '../constants';

/**
 * The `config.json` found at the root of each problem directory inside a
 * problem ZIP (single-problem ZIP root or per-problem subdirectory of a batch
 * ZIP — both go through this one schema).
 *
 * Optional metadata fields carry tri-state semantics that the schema layer
 * must preserve rather than normalize away:
 *  - omitted  → caller decides (new problem: apply defaults; existing
 *    problem: leave the stored value untouched)
 *  - null / [] → explicitly clear the stored value
 *
 * `collection` is referenced by *name* (not id) so exported archives stay
 * portable across databases; empty/whitespace-only strings normalize to null
 * (no collection) so a blank string can never create a nameless collection.
 */

const unknownCategoryMessage = (
  issue: z.core.$ZodRawIssue<z.core.$ZodIssueInvalidValue>,
): string =>
  `Unknown category "${String(issue.input)}". Allowed: ${PROBLEM_CATEGORIES.join(', ')}`;

/** Categories as a tri-state field: undefined = omitted, [] = uncategorized.
 *  Trimmed, deduplicated and sorted on the way in — the same normalization
 *  normal problem editing applies (requestSchemas problemCategories) — so
 *  equal sets always compare equal. */
const zipConfigCategories = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (typeof value === 'string') return value.trim() === '' ? [] : [value.trim()];
    if (Array.isArray(value)) {
      const trimmed = value.map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
        .filter((entry) => entry !== '');
      return [...new Set(trimmed)].sort();
    }
    return value;
  },
  z.array(
    z.enum(PROBLEM_CATEGORIES, { error: unknownCategoryMessage }),
  ).optional(),
);

/** Difficulty on the same 800–3500 step-100 scale as normal problem editing;
 *  undefined = omitted, null = Unrated (or clear on existing problems). */
const zipConfigDifficulty = z.number().int()
  .min(PROBLEM_DIFFICULTY_MIN, {
    message: `difficulty must be between ${PROBLEM_DIFFICULTY_MIN} and ${PROBLEM_DIFFICULTY_MAX} (multiples of ${PROBLEM_DIFFICULTY_STEP})`,
  })
  .max(PROBLEM_DIFFICULTY_MAX, {
    message: `difficulty must be between ${PROBLEM_DIFFICULTY_MIN} and ${PROBLEM_DIFFICULTY_MAX} (multiples of ${PROBLEM_DIFFICULTY_STEP})`,
  })
  .refine((value) => value % PROBLEM_DIFFICULTY_STEP === 0, {
    message: `difficulty must be a multiple of ${PROBLEM_DIFFICULTY_STEP}`,
  })
  .nullable()
  .optional();

/** Collection by name: undefined/null = no collection (or clear), trimmed
 *  non-empty string = the collection to reuse or create. */
const zipConfigCollection = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value;
  },
  z.string().min(1).max(STRING_LIMITS.COLLECTION_NAME).nullable().optional(),
);

export const problemZipConfigSchema = z.object({
  id: z.string().trim().min(1).max(AUTHORING_VALIDATION.MAX_PROBLEM_ID_LENGTH),
  title: z.string().trim()
    .min(PROBLEM_VALIDATION.MIN_TITLE_LENGTH)
    .max(STRING_LIMITS.TITLE),
  author: z.string().trim()
    .min(PROBLEM_VALIDATION.MIN_AUTHOR_LENGTH)
    .max(STRING_LIMITS.AUTHOR),
  time_limit_ms: z.number().int().min(PROBLEM_VALIDATION.MIN_TIME_LIMIT_MS),
  memory_limit_mb: z.number().int().min(PROBLEM_VALIDATION.MIN_MEMORY_LIMIT_MB),
  categories: zipConfigCategories,
  difficulty: zipConfigDifficulty,
  collection: zipConfigCollection,
});

/** Parsed config.json with presence-preserving metadata fields. */
export interface ProblemZipConfig {
  id: string;
  title: string;
  author: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  /** undefined = field omitted; array (possibly empty) = explicit set. */
  categories?: Array<(typeof PROBLEM_CATEGORIES)[number]>;
  /** undefined = field omitted; null = Unrated/clear; number = rating. */
  difficulty?: number | null;
  /** undefined = field omitted; null = no collection/clear; string = collection name. */
  collection?: string | null;
}

/** Flatten a ZodError from the ZIP config into one human-readable line. */
export const formatProblemZipConfigError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => (issue.path.length > 0
      ? `config.json "${issue.path.join('.')}" is invalid: ${issue.message}`
      : `config.json is invalid: ${issue.message}`))
    .join('; ');
