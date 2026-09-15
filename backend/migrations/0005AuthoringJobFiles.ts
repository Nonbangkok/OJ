export const authoringJobFilesSql = `
CREATE TABLE authoring_job_files (
  job_id UUID NOT NULL REFERENCES authoring_jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content BYTEA NOT NULL,
  PRIMARY KEY (job_id, name)
);
`;
