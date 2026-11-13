export const headerProblemsSql = `
ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS problem_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS submission_filename TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'problems_problem_type_check'
                 AND conrelid = 'problems'::regclass) THEN
    ALTER TABLE problems
      ADD CONSTRAINT problems_problem_type_check CHECK (problem_type IN ('standard', 'header'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'problems_header_filename_check'
                 AND conrelid = 'problems'::regclass) THEN
    ALTER TABLE problems
      ADD CONSTRAINT problems_header_filename_check
      CHECK ((problem_type = 'header') = (submission_filename IS NOT NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS problem_files (
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE ON UPDATE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('grader', 'starter')),
  filename TEXT NOT NULL,
  content BYTEA NOT NULL,
  PRIMARY KEY (problem_id, role, filename)
);
`;
