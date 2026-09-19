export const submissionIndexesSql = `
-- Indexes for the two submission pools. Until now both tables had no
-- secondary indexes at all (only the contest family had some), so every
-- analytics/profile/scoreboard query that filters by user, problem, or
-- submitted_at did a sequential scan over the full history.
--
-- The analysis tab is the heaviest consumer: it UNION ALLs both pools for
-- every endpoint (overview KPIs, daily series, verdict breakdown, top lists,
-- per-user / per-problem drill-downs), and listSubmissionsForAnalytics sorts
-- the union by submitted_at DESC. The global scoreboard groups submissions by
-- (user_id, problem_id); user profiles filter by user_id over both pools.

-- submissions (main pool)
CREATE INDEX IF NOT EXISTS idx_submissions_user
  ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem
  ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at
  ON submissions(submitted_at DESC);

-- contest_submissions
CREATE INDEX IF NOT EXISTS idx_contest_submissions_user
  ON contest_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_contest_submissions_problem
  ON contest_submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_contest_submissions_submitted_at
  ON contest_submissions(submitted_at DESC);

-- The existing composite idx_contest_submissions_contest_user covers
-- contest_id lookups, but a plain contest_id index also serves the
-- analytics contest timeline which filters by contest_id alone.
CREATE INDEX IF NOT EXISTS idx_contest_submissions_contest
  ON contest_submissions(contest_id);

-- users.username already carries a UNIQUE constraint from 0001 (implicit
-- index), so login lookups are covered; no users index needed here.
`;
