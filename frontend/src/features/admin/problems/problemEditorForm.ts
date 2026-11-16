import type { AdminProblemDetailResponse } from '../../../types';
import type { UpdateProblemRequest } from '../../../types/service';

export const DEFAULT_SUBMISSION_FILENAME = 'student.h';
export const TYPE_LOCK_MESSAGE = 'Problem type and submission filename cannot change after submissions exist.';

export type ProblemType = 'standard' | 'header';

/** The General tab's editable fields; limits stay strings while typing. */
export interface ProblemEditorForm {
  id: string;
  title: string;
  author: string;
  time_limit_ms: string;
  memory_limit_mb: string;
  difficulty: number | null;
  collection_id: number | null;
  categories: string[];
  problem_type: ProblemType;
  submission_filename: string;
}

/** The admin detail (GET /admin/problems/:id) with the B6 facts merged in. */
export type AdminProblemEditorDetail = AdminProblemDetailResponse & {
  contest_id?: number | null;
  collection_id?: number | null;
  submission_count?: number;
  type_locked?: boolean;
  testcase_count?: number;
  testcase_bytes?: number;
};

export type FieldErrors = Partial<Record<keyof ProblemEditorForm, string>>;

export const formFromDetail = (detail: AdminProblemEditorDetail): ProblemEditorForm => ({
  id: detail.id,
  title: detail.title ?? '',
  author: detail.author ?? '',
  time_limit_ms: String(detail.time_limit_ms),
  memory_limit_mb: String(detail.memory_limit_mb),
  difficulty: detail.difficulty ?? null,
  collection_id: detail.collection_id ?? null,
  categories: [...(detail.categories ?? [])].sort(),
  problem_type: detail.problem_type ?? 'standard',
  submission_filename: detail.submission_filename ?? DEFAULT_SUBMISSION_FILENAME,
});

export const isFormDirty = (saved: ProblemEditorForm, form: ProblemEditorForm) => (
  JSON.stringify(saved) !== JSON.stringify(form)
);

/** Client-side checks the backend would reject anyway, shown on the field. */
export const validateForm = (form: ProblemEditorForm): FieldErrors => {
  const errors: FieldErrors = {};
  if (!form.id.trim()) errors.id = 'Problem ID is required.';
  if (!form.title.trim()) errors.title = 'Title is required.';
  const time = Number(form.time_limit_ms);
  if (!Number.isInteger(time) || time < 100) errors.time_limit_ms = 'Time limit must be a whole number of at least 100 ms.';
  const memory = Number(form.memory_limit_mb);
  if (!Number.isInteger(memory) || memory < 1) errors.memory_limit_mb = 'Memory limit must be a whole number of at least 1 MB.';
  if (form.problem_type === 'header' && !form.submission_filename.trim()) {
    errors.submission_filename = 'Submission filename is required for header problems.';
  }
  return errors;
};

/**
 * PUT body with only what changed. `id` is always sent (the endpoint needs
 * it); the type and filename travel together, and only when one of them
 * changed, so ordinary edits never touch the fields that lock.
 */
export const changedFields = (saved: ProblemEditorForm, form: ProblemEditorForm): UpdateProblemRequest => {
  const body: UpdateProblemRequest = { id: form.id.trim() };
  if (form.title !== saved.title) body.title = form.title;
  if (form.author !== saved.author) body.author = form.author;
  if (form.time_limit_ms !== saved.time_limit_ms) body.time_limit_ms = Number(form.time_limit_ms);
  if (form.memory_limit_mb !== saved.memory_limit_mb) body.memory_limit_mb = Number(form.memory_limit_mb);
  if (form.difficulty !== saved.difficulty) body.difficulty = form.difficulty;
  if (form.collection_id !== saved.collection_id) body.collection_id = form.collection_id;
  if (form.categories.join('\n') !== saved.categories.join('\n')) body.categories = form.categories as UpdateProblemRequest['categories'];
  const isHeader = form.problem_type === 'header';
  const filename = form.submission_filename.trim();
  const typeChanged = form.problem_type !== saved.problem_type
    || (isHeader && filename !== saved.submission_filename);
  if (typeChanged) {
    body.problem_type = form.problem_type;
    body.submission_filename = isHeader ? filename : null;
  }
  return body;
};

/** Maps a Zod 400 (`errors: [{ path, message }]`) onto the form's fields. */
export const fieldErrorsFrom400 = (data: unknown): FieldErrors => {
  const issues = (data as { errors?: Array<{ path?: unknown[]; message?: string }> } | undefined)?.errors;
  const errors: FieldErrors = {};
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues) {
    const key = issue.path?.[0];
    if (typeof key === 'string' && issue.message && !(key in errors)) {
      errors[key as keyof ProblemEditorForm] = issue.message;
    }
  }
  return errors;
};
