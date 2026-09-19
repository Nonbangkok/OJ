export const userProfileSql = `
ALTER TABLE users ADD COLUMN avatar_png BYTEA;
ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMPTZ;
`;
