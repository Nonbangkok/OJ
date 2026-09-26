export const collectionDescriptionSql = `
-- Collection descriptions, take two. 0014 shipped a description column that
-- the UI never wired up, so 0015 dropped it as dead weight. The redesigned
-- Manage Collections dialog now has a real home for it: an optional
-- "what is this group for" blurb on the create/edit form. Nullable VARCHAR,
-- no NOT NULL, no default — existing collections simply have no description.
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS description VARCHAR(500);
`;
