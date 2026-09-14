/** Durable, immutable input bytes; separated from JSON to deliver one bounded file at a time. */
export const authoringJobInputsSql = `
CREATE TABLE authoring_job_inputs (
  job_id UUID NOT NULL REFERENCES authoring_jobs(id) ON DELETE CASCADE,
  case_id UUID NOT NULL,
  case_number INTEGER NOT NULL CHECK (case_number > 0),
  input_data TEXT NOT NULL,
  PRIMARY KEY (job_id, case_id),
  UNIQUE (job_id, case_number)
);
`;
