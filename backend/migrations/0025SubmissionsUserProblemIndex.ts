/**
 * Supports the problem list's per-viewer status filter and counts (B2):
 * EXISTS probes on (user_id, problem_id[, score]) for every listed problem.
 */
export const submissionsUserProblemIndexSql = `
CREATE INDEX IF NOT EXISTS idx_submissions_user_problem ON submissions (user_id, problem_id, score);
`;
