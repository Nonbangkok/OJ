export const dropCollectionDescriptionAgainSql = `
-- Collection descriptions, take three: 0021 re-added the column for the
-- redesigned Manage Collections dialog, but the product decision landed on
-- keeping collection metadata minimal (name only). Drop it again.
ALTER TABLE collections DROP COLUMN IF EXISTS description;
`;
