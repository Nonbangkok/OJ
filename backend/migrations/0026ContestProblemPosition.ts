/**
 * Contest problem order (B4). While a contest is scheduled or running its
 * problems are `problems.contest_id` rows, ordered by `contest_position`;
 * the finish-time snapshot (`contest_problems`) keeps that order in
 * `position`. Existing rows are backfilled in id order, the order every
 * contest page used before.
 */
export const contestProblemPositionBackfillSql = `
UPDATE problems p
SET contest_position = ranked.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY contest_id ORDER BY id) AS rn
  FROM problems
  WHERE contest_id IS NOT NULL
) ranked
WHERE p.id = ranked.id AND p.contest_position IS NULL;

UPDATE contest_problems cp
SET position = ranked.rn
FROM (
  SELECT contest_id, problem_id, ROW_NUMBER() OVER (PARTITION BY contest_id ORDER BY problem_id) AS rn
  FROM contest_problems
) ranked
WHERE cp.contest_id = ranked.contest_id AND cp.problem_id = ranked.problem_id AND cp.position IS NULL;
`;

export const contestProblemPositionSql = `
ALTER TABLE problems ADD COLUMN IF NOT EXISTS contest_position INTEGER;
ALTER TABLE contest_problems ADD COLUMN IF NOT EXISTS position INTEGER;
${contestProblemPositionBackfillSql}
`;
