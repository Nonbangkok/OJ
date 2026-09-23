export const dropCollectionDescriptionSql = `
-- Collections never used the description field; drop it so the UI and API
-- carry only what the feature actually needs.
ALTER TABLE collections DROP COLUMN IF EXISTS description;
`;
