/**
 * Supports the problem list's per-viewer status filter and counts (B2):
 * EXISTS probes on (user_id, problem_id[, score]) for every listed problem.
 *
 * Built CONCURRENTLY: submissions is the largest table, and a plain CREATE INDEX
 * would block every new submission and verdict write for the whole build while the
 * old backend is still serving during a deploy. A failed concurrent build leaves an
 * INVALID index behind, so the rerun drops it before building again.
 */
export const submissionsUserProblemIndexStatements: readonly string[] = Object.freeze([
  'DROP INDEX CONCURRENTLY IF EXISTS idx_submissions_user_problem',
  'CREATE INDEX CONCURRENTLY idx_submissions_user_problem ON submissions (user_id, problem_id, score)',
]);
