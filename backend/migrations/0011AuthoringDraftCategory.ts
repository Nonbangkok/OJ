export const authoringDraftCategorySql = `
-- Problem category travels with the authoring draft so a published problem
-- carries its category from the draft instead of needing a legacy edit
-- afterwards. Nullable: uncategorized stays a valid state.
ALTER TABLE problem_drafts ADD COLUMN category VARCHAR(50);

-- Provenance records the category of the last authoring publication so the
-- republish guard can detect out-of-band legacy category edits, exactly like
-- title/author/limits. Backfill from the live problems rows for already
-- published drafts (NULL there is a legitimate "uncategorized").
ALTER TABLE authoring_published_problems ADD COLUMN category VARCHAR(50);

UPDATE authoring_published_problems app
SET category = p.category
FROM problems p
WHERE app.problem_id = p.id;
`;
