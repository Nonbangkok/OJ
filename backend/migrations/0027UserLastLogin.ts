/** Users list "Last active" (B5): the latest of the last login and the last submission. */
export const userLastLoginSql = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
`;
