export const profileSyncSql = `
-- Per-draft PDF rebuild used by the profile auto-sync cascade. It is delivered
-- and imported by the same runner protocol as build_pdf, but a published draft
-- stays published: only author metadata and the embedded PDF change.
ALTER TABLE authoring_jobs DROP CONSTRAINT authoring_jobs_job_type_check;
ALTER TABLE authoring_jobs ADD CONSTRAINT authoring_jobs_job_type_check CHECK (job_type IN (
  'compile_solution', 'compile_generator', 'run_generator',
  'generate_outputs', 'build_pdf', 'verify_all', 'sync_pdf'
));

-- One cascade per confirmed author-profile edit.
CREATE TABLE authoring_profile_syncs (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES author_profiles(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'succeeded', 'failed'
  )),
  result_summary JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_authoring_profile_syncs_status
  ON authoring_profile_syncs(status, created_at);

-- Per-draft work items inside one cascade; unique per sync so retries resume.
CREATE TABLE authoring_profile_sync_items (
  id UUID PRIMARY KEY,
  sync_id UUID NOT NULL REFERENCES authoring_profile_syncs(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES problem_drafts(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'syncing', 'synced', 'failed', 'deferred'
  )),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  sync_revision INT CHECK (sync_revision IS NULL OR sync_revision >= 1),
  sync_pdf_job_id UUID REFERENCES authoring_jobs(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sync_id, draft_id)
);

CREATE INDEX idx_authoring_profile_sync_items_draft
  ON authoring_profile_sync_items(draft_id, status);
CREATE INDEX idx_authoring_profile_sync_items_job
  ON authoring_profile_sync_items(sync_pdf_job_id);
`;
