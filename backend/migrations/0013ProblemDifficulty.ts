export const problemDifficultySql = `
-- Problem difficulty on a Codeforces-like numeric scale (800–3500, step 100).
-- Nullable: existing problems keep NULL (= Unrated). The same column lands on
-- all three tables of the authoring publish pattern (problems,
-- problem_drafts, authoring_published_problems) so a draft's difficulty
-- carries end-to-end into the published problem and its provenance snapshot.

ALTER TABLE problems ADD COLUMN difficulty INT;
ALTER TABLE problem_drafts ADD COLUMN difficulty INT;
ALTER TABLE authoring_published_problems ADD COLUMN difficulty INT;

ALTER TABLE problems ADD CONSTRAINT problems_difficulty_check
  CHECK (difficulty IS NULL OR (difficulty BETWEEN 800 AND 3500 AND difficulty % 100 = 0));
ALTER TABLE problem_drafts ADD CONSTRAINT problem_drafts_difficulty_check
  CHECK (difficulty IS NULL OR (difficulty BETWEEN 800 AND 3500 AND difficulty % 100 = 0));
ALTER TABLE authoring_published_problems ADD CONSTRAINT authoring_published_problems_difficulty_check
  CHECK (difficulty IS NULL OR (difficulty BETWEEN 800 AND 3500 AND difficulty % 100 = 0));
`;
