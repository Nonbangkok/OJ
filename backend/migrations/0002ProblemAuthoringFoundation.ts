export const problemAuthoringFoundationSql = `
CREATE TABLE author_profiles (
  id UUID PRIMARY KEY,
  user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  aka_name VARCHAR(100) NOT NULL,
  real_name VARCHAR(255) NOT NULL,
  default_language VARCHAR(50) NOT NULL,
  country_code VARCHAR(3) NOT NULL,
  profile_image_png BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE problem_drafts (
  id UUID PRIMARY KEY,
  problem_id VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  author_profile_id UUID REFERENCES author_profiles(id) ON DELETE SET NULL,
  author_aka_name VARCHAR(100) NOT NULL,
  author_real_name VARCHAR(255) NOT NULL,
  language VARCHAR(50) NOT NULL,
  country_code VARCHAR(3) NOT NULL,
  author_profile_image_png BYTEA,
  time_limit_ms INT NOT NULL CHECK (time_limit_ms > 0),
  memory_limit_mb INT NOT NULL CHECK (memory_limit_mb > 0),
  statement_html TEXT NOT NULL DEFAULT '',
  solution_cpp TEXT NOT NULL DEFAULT '',
  generator_cpp TEXT,
  latest_pdf BYTEA,
  latest_pdf_revision INT,
  template_version VARCHAR(50) NOT NULL DEFAULT 'red-gate-v1',
  revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  verified_revision INT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generated', 'ready', 'published')),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CHECK (latest_pdf_revision IS NULL OR latest_pdf_revision >= 1),
  CHECK (verified_revision IS NULL OR verified_revision >= 1)
);

CREATE TABLE problem_draft_assets (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES problem_drafts(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  content BYTEA NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, filename)
);

CREATE TABLE problem_draft_testcases (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES problem_drafts(id) ON DELETE CASCADE,
  case_number INT NOT NULL CHECK (case_number > 0),
  original_input_filename VARCHAR(255) NOT NULL,
  input_data TEXT NOT NULL,
  output_data TEXT,
  source VARCHAR(20) NOT NULL CHECK (source IN ('uploaded', 'generated')),
  source_revision INT NOT NULL CHECK (source_revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, case_number)
);

CREATE TABLE authoring_jobs (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES problem_drafts(id) ON DELETE CASCADE,
  job_type VARCHAR(30) NOT NULL CHECK (job_type IN (
    'compile_solution', 'compile_generator', 'run_generator',
    'generate_outputs', 'build_pdf', 'verify_all'
  )),
  draft_revision INT NOT NULL CHECK (draft_revision >= 1),
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'compiling', 'running', 'succeeded',
    'failed', 'timed_out', 'cancelled', 'stale'
  )),
  result_summary JSONB,
  log TEXT NOT NULL DEFAULT '',
  error_code VARCHAR(100),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_problem_drafts_status_updated
  ON problem_drafts(status, updated_at DESC);
CREATE INDEX idx_problem_drafts_created_by
  ON problem_drafts(created_by);
CREATE INDEX idx_problem_draft_testcases_draft_case
  ON problem_draft_testcases(draft_id, case_number);
CREATE INDEX idx_authoring_jobs_draft_created
  ON authoring_jobs(draft_id, created_at DESC);
CREATE INDEX idx_authoring_jobs_status_created
  ON authoring_jobs(status, created_at);
`;
