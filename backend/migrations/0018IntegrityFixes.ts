export const integrityFixesSql = `
-- Phase 4 integrity fixes (audit XSYS-004 / DB-08 / DB-09 / DB-12).

-- XSYS-004 + CONTEST-006: snapshot a problem's pre-contest visibility so every
-- contest exit path (bulk move-back, single move-back, contest delete, post-
-- contest migration) restores exactly what was there before the problem was
-- attached to the contest, instead of force-publishing hidden problems or
-- leaving them invisible forever. NULL means "never been in a contest" — the
-- move-to-contest code is the only writer.
ALTER TABLE problems ADD COLUMN is_visible_before_contest BOOLEAN;

-- DB-08 + AUTH-006: usernames must be unique case-insensitively so lookalike
-- accounts ("Alice" vs "alice") cannot exist. The audit confirmed zero
-- case-insensitive collisions in the live data, so the index builds cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
  ON users (LOWER(username));

-- DB-09: user_sessions.expire was timestamp-without-tz while every other
-- timestamp in the schema is timestamptz. connect-pg-simple writes UTC values,
-- so the conversion is lossless.
ALTER TABLE user_sessions ALTER COLUMN expire TYPE timestamptz;

-- DB-12: draft 'geo-convex' reached status='published' with published_at
-- NULL (a historically broken publish path), which breaks the republish
-- branch (it distinguishes first publish from republish by published_at).
-- Self-heal the invariant: a published draft with no timestamp backfills it
-- from its last update time.
UPDATE problem_drafts
SET published_at = COALESCE(published_at, updated_at)
WHERE status = 'published' AND published_at IS NULL;
`;
