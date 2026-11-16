/** B7: the draft list reads the newest job per (draft, type) with DISTINCT ON — this index serves it without a sort. */
export const authoringJobsDraftTypeIndexSql = `
CREATE INDEX IF NOT EXISTS idx_authoring_jobs_draft_type_created
  ON authoring_jobs(draft_id, job_type, created_at DESC);
`;
