export const contestVisibilitySql = `
-- Contest visibility: an administrative publishing/access gate for end
-- users, fully INDEPENDENT from contest status. 'true' (default) preserves
-- the existing behavior — every existing contest stays visible. Hidden
-- contests are invisible to normal users and guests on every public route
-- while remaining fully manageable by staff/admin and untouched by the
-- internal judge/scheduler/migration pipelines.
ALTER TABLE contests
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
`;
