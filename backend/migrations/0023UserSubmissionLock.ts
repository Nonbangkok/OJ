export const userSubmissionLockSql = `
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS submissions_locked BOOLEAN NOT NULL DEFAULT FALSE;
`;
