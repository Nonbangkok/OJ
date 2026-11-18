/**
 * A5-04: remember which contest a practice-pool submission came from.
 *
 * At contest finish migrateSubmissionsAfterContest copies the contest's
 * contest_submissions into `submissions` and deletes the originals, so after
 * the finish nothing said which rows were the contest's: cheat detection and
 * contest analytics came back empty for every finished contest. The copy now
 * records the contest in `submissions.contest_id`. Rows submitted in practice
 * keep NULL, and so do rows migrated by contests that finished before this
 * migration (no backfill: participants may also have practised the problems
 * inside the contest window, so the origin cannot be recovered reliably).
 * Deleting a contest keeps its migrated submissions in the practice pool and
 * only clears the link (ON DELETE SET NULL).
 *
 * Every row lives in exactly one of submissions / contest_submissions at a
 * time, so the UNION ALL readers (profile, analytics, progression) still count
 * each submission once.
 *
 * Run as separate statements: submissions is the largest table. Adding the
 * nullable column is metadata only; the foreign key is added NOT VALID (no
 * scan under the ALTER's lock) and validated afterwards, which only takes a
 * SHARE UPDATE EXCLUSIVE lock, so submissions and verdicts keep writing; the
 * index is built CONCURRENTLY like 0025. Each statement is safe to rerun
 * (the runner restarts from the first one after a deadlock), and a failed
 * concurrent build leaves an INVALID index behind, so the rerun drops it.
 * The partial index covers only contest rows, the only ones it is read for.
 */
export const submissionsContestIdStatements: readonly string[] = Object.freeze([
  'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS contest_id INTEGER',
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'submissions_contest_id_fkey' AND conrelid = 'submissions'::regclass
  ) THEN
    ALTER TABLE submissions ADD CONSTRAINT submissions_contest_id_fkey
      FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$`,
  'ALTER TABLE submissions VALIDATE CONSTRAINT submissions_contest_id_fkey',
  'DROP INDEX CONCURRENTLY IF EXISTS idx_submissions_contest_id',
  'CREATE INDEX CONCURRENTLY idx_submissions_contest_id ON submissions (contest_id) WHERE contest_id IS NOT NULL',
]);
