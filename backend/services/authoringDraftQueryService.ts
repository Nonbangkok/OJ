import * as db from '../db';
import { ProblemDraftRow } from '../types/authoring';

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
  'time_limit_ms',
  'memory_limit_mb',
  'statement_html',
  'solution_cpp',
  'generator_cpp',
  'template_version',
];

export const updateProblemDraft = async (
  draftId: string,
  expectedRevision: number,
  updates: ProblemDraftUpdates,
): Promise<UpdateProblemDraftResult> => {
  const assignments: string[] = [];
  const values: unknown[] = [draftId, expectedRevision];

  for (const field of EDITABLE_FIELDS) {
    const value = updates[field];
    if (value === undefined) {
      continue;
    }
    values.push(value);
    assignments.push(`${field} = $${values.length}`);
  }

  if (assignments.length === 0) {
    throw new Error('At least one editable draft field is required');
  }

  const updateResult = await db.query<ProblemDraftRow>(`
    UPDATE problem_drafts
    SET ${assignments.join(', ')},
        revision = revision + 1, status = 'draft', verified_revision = NULL,
        updated_at = NOW()
    WHERE id = $1 AND revision = $2 AND status <> 'published'
    RETURNING *
  `, values);

  const updatedDraft = updateResult.rows[0];
  if (updatedDraft) {
    return { kind: 'updated', draft: updatedDraft };
  }

  const currentResult = await db.query<ProblemDraftRow>(
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
  return { kind: 'revision_conflict', draft: currentDraft };
};
