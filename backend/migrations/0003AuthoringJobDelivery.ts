export const authoringJobDeliverySql = `
ALTER TABLE authoring_jobs ADD COLUMN request_snapshot JSONB;

-- Older jobs have no durable request to redeliver after restart.
UPDATE authoring_jobs SET status = 'failed', error_code = 'missing_snapshot',
  error_message = 'Job predates durable runner delivery; please retry', finished_at = NOW()
WHERE status IN ('queued', 'compiling', 'running');

CREATE UNIQUE INDEX idx_authoring_jobs_one_active_draft ON authoring_jobs(draft_id)
WHERE status IN ('queued', 'compiling', 'running');
`;
