import { randomUUID } from 'crypto';
import type { QueryResultRow } from 'pg';
import * as db from '../db';
import { ProblemDraftRow } from '../types/authoring';

export type AuthoringDraftDatabase = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type CreateProblemDraftInput = Pick<
  ProblemDraftRow,
  | 'problem_id'
  | 'title'
  | 'author_profile_id'
  | 'author_aka_name'
  | 'author_real_name'
  | 'language'
  | 'country_code'
  | 'categories'
  | 'time_limit_ms'
  | 'memory_limit_mb'
  | 'created_by'
> & Partial<Pick<
  ProblemDraftRow,
  | 'difficulty'
  | 'author_profile_image_png'
  | 'statement_html'
  | 'solution_cpp'
  | 'generator_cpp'
  | 'template_version'
>>;

export type ProblemDraftListRow = Pick<
  ProblemDraftRow,
  | 'id'
  | 'problem_id'
  | 'title'
  | 'author_aka_name'
  | 'status'
  | 'revision'
  | 'verified_revision'
  | 'created_by'
  | 'created_at'
  | 'updated_at'
>;

type EditableProblemDraftFields = Pick<
  ProblemDraftRow,
  | 'problem_id'
  | 'title'
  | 'author_profile_id'
  | 'author_aka_name'
  | 'author_real_name'
  | 'language'
  | 'country_code'
  | 'author_profile_image_png'
  | 'categories'
  | 'difficulty'
  | 'time_limit_ms'
  | 'memory_limit_mb'
  | 'statement_html'
  | 'solution_cpp'
  | 'generator_cpp'
  | 'template_version'
>;

export type ProblemDraftUpdates = Partial<EditableProblemDraftFields>;

export type UpdateProblemDraftResult =
  | { kind: 'updated'; draft: ProblemDraftRow }
  | { kind: 'revision_conflict'; draft: ProblemDraftRow }
  | { kind: 'published'; draft: ProblemDraftRow }
  | { kind: 'published_problem_id_locked'; draft: ProblemDraftRow }
  | { kind: 'not_found' };

export type StartProblemDraftRevisionResult =
  | { kind: 'updated'; draft: ProblemDraftRow }
  | { kind: 'not_published'; draft: ProblemDraftRow }
  | { kind: 'not_found' };

const EDITABLE_FIELDS: readonly (keyof EditableProblemDraftFields)[] = [
  'problem_id',
  'title',
  'author_profile_id',
  'author_aka_name',
  'author_real_name',
  'language',
  'country_code',
  'author_profile_image_png',
  'categories',
  'difficulty',
  'time_limit_ms',
  'memory_limit_mb',
  'statement_html',
  'solution_cpp',
  'generator_cpp',
  'template_version',
];

export const createProblemDraft = async (
  input: CreateProblemDraftInput,
  database: AuthoringDraftDatabase = db,
): Promise<ProblemDraftRow> => {
  const id = randomUUID();
  const result = await database.query<ProblemDraftRow>(`
    INSERT INTO problem_drafts (
      id, problem_id, title, author_profile_id, author_aka_name,
      author_real_name, language, country_code, author_profile_image_png,
      categories, difficulty, time_limit_ms, memory_limit_mb, statement_html, solution_cpp,
      generator_cpp, template_version, created_by
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15,
      $16, $17, $18
    )
    RETURNING *
  `, [
    id,
    input.problem_id,
    input.title,
    input.author_profile_id,
    input.author_aka_name,
    input.author_real_name,
    input.language,
    input.country_code,
    input.author_profile_image_png ?? null,
    [...input.categories],
    input.difficulty ?? null,
    input.time_limit_ms,
    input.memory_limit_mb,
    input.statement_html ?? '',
    input.solution_cpp ?? '',
    input.generator_cpp ?? null,
    input.template_version ?? 'red-gate-v1',
    input.created_by,
  ]);

  return result.rows[0];
};

export const listProblemDrafts = async (
  database: AuthoringDraftDatabase = db,
): Promise<ProblemDraftListRow[]> => {
  const result = await database.query<ProblemDraftListRow>(`
    SELECT
      id, problem_id, title, author_aka_name, status, revision,
      verified_revision, created_by, created_at, updated_at
    FROM problem_drafts
    ORDER BY updated_at DESC, id ASC
  `);
  return result.rows;
};

export const getProblemDraft = async (
  draftId: string,
  database: AuthoringDraftDatabase = db,
): Promise<ProblemDraftRow | null> => {
  const result = await database.query<ProblemDraftRow>(
    'SELECT * FROM problem_drafts WHERE id = $1',
    [draftId],
  );
  return result.rows[0] ?? null;
};

export const updateProblemDraft = async (
  draftId: string,
  expectedRevision: number,
  updates: ProblemDraftUpdates,
  database: AuthoringDraftDatabase = db,
): Promise<UpdateProblemDraftResult> => {
  const assignments: string[] = [];
  const values: unknown[] = [draftId, expectedRevision];

  for (const field of EDITABLE_FIELDS) {
    const value = updates[field];
    if (value === undefined) {
      continue;
    }
    // Categories normalize to a sorted, deduplicated set at the storage layer
    // too (not just in request validation) so the publish provenance guard's
    // element-wise array comparison is order-independent.
    const normalized = field === 'categories' && Array.isArray(value)
      ? [...new Set(value)].sort()
      : value;
    values.push(normalized);
    assignments.push(`${field} = $${values.length}`);
  }

  if (assignments.length === 0) {
    throw new Error('At least one editable draft field is required');
  }

  // A published task may begin a new authoring cycle only by correcting its
  // statement. All other metadata and source changes stay locked until the
  // draft has returned to the normal editable state.
  const isPublishedStatementRevision = assignments.length === 1
    && assignments[0].startsWith('statement_html =');
  const changesPublishedProblemId = assignments.some(assignment => assignment.startsWith('problem_id ='));
  let publishedGuard = "status <> 'published'";
  if (isPublishedStatementRevision) {
    values.push(true);
    publishedGuard = `(status <> 'published' OR $${values.length}::boolean)`;
  }

  const updateResult = await database.query<ProblemDraftRow>(`
    UPDATE problem_drafts
    SET ${assignments.join(', ')},
        revision = revision + 1, status = 'draft', verified_revision = NULL,
        updated_at = NOW()
    WHERE id = $1 AND revision = $2 AND ${publishedGuard}
      ${changesPublishedProblemId ? 'AND published_at IS NULL' : ''}
    RETURNING *
  `, values);

  const updatedDraft = updateResult.rows[0];
  if (updatedDraft) {
    return { kind: 'updated', draft: updatedDraft };
  }

  const currentResult = await database.query<ProblemDraftRow>(
    'SELECT * FROM problem_drafts WHERE id = $1',
    [draftId],
  );
  const currentDraft = currentResult.rows[0];

  if (!currentDraft) {
    return { kind: 'not_found' };
  }
  if (currentDraft.status === 'published') {
    return { kind: 'published', draft: currentDraft };
  }
  if (changesPublishedProblemId && currentDraft.published_at !== null) {
    return { kind: 'published_problem_id_locked', draft: currentDraft };
  }
  return { kind: 'revision_conflict', draft: currentDraft };
};

/**
 * Transition a published draft back into the editable state so a new
 * authoring cycle can begin. `published_at` stays set so the legacy Problem
 * ID remains locked to the live grader problem, while the revision counter
 * advances and the verified revision is cleared (the stored PDF and
 * verification now describe an older revision).
 */
export const startProblemDraftRevision = async (
  draftId: string,
  database: AuthoringDraftDatabase = db,
): Promise<StartProblemDraftRevisionResult> => {
  const updateResult = await database.query<ProblemDraftRow>(`
    UPDATE problem_drafts
    SET status = 'draft',
        revision = revision + 1,
        verified_revision = NULL,
        updated_at = NOW()
    WHERE id = $1 AND status = 'published'
    RETURNING *
  `, [draftId]);

  const updatedDraft = updateResult.rows[0];
  if (updatedDraft) {
    return { kind: 'updated', draft: updatedDraft };
  }

  const currentResult = await database.query<ProblemDraftRow>(
    'SELECT * FROM problem_drafts WHERE id = $1',
    [draftId],
  );
  const currentDraft = currentResult.rows[0];
  if (!currentDraft) {
    return { kind: 'not_found' };
  }
  return { kind: 'not_published', draft: currentDraft };
};
