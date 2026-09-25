import { query } from '../db';
import { ANALYTICS_TIMEZONE, SUBMISSION_STATUS } from '../constants';

export interface OverviewKpi {
  current: number;
  previous: number;
}

export interface OverviewAnalytics {
  kpis: {
    submissions: OverviewKpi;
    uniqueSubmitters: OverviewKpi;
    accepted: OverviewKpi;
    newUsers: OverviewKpi;
    activeProblems: OverviewKpi;
  };
  dailySeries: Array<{ day: string; total: number; accepted: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  topProblems: Array<{ problemId: string; title: string; submissions: number; accepted: number }>;
  topSubmitters: Array<{ userId: number; username: string; submissions: number; solved: number }>;
  contestStats: Array<{ contestId: number; title: string; status: string; submissions: number; participants: number; avgScore: number }>;
}

interface KpiRow {
  current_submissions: string;
  previous_submissions: string;
  current_submitters: string;
  previous_submitters: string;
  current_accepted: string;
  previous_accepted: string;
}

interface NewUsersRow {
  current_users: string;
  previous_users: string;
}

interface DailyRow {
  day: string;
  total: string;
  accepted: string;
}

interface VerdictRow {
  verdict: string;
  count: string;
}

interface TopProblemRow {
  problem_id: string;
  title: string;
  submissions: string;
  accepted: string;
}

interface TopSubmitterRow {
  user_id: number;
  username: string;
  submissions: string;
  solved: string;
}

interface ContestStatRow {
  contest_id: number;
  title: string;
  status: string;
  submissions: string;
  participants: string;
  avg_score: string | null;
}

/** Large enough window standing in for "all time" in day-based intervals. */
const ALL_TIME_WINDOW_DAYS = 36500;

/**
 * ANALYSIS-007: ILIKE treats user-supplied `%` and `_` as wildcards, so a
 * search like "100%" matches far more than intended. Backslash-escape both
 * (Postgres LIKE escape character). Backslashes in the search term are not
 * special for LIKE itself, but escaping them too keeps the term literal.
 */
const escapeLikePattern = (search: string): string =>
  search.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const toNum = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));

/** Aggregate rows always return one row, but stay defensive for empty results. */
const firstRow = <T>(rows: T[]): T | undefined => rows[0];

/**
 * Aggregates the system-level analytics shown on the analysis tab overview.
 * Window: `days` for the current period, the equal-length period before it
 * for comparison. Submission metrics cover both the standalone pool and the
 * contest pool.
 */
export const getOverviewAnalytics = async (days: number): Promise<OverviewAnalytics> => {
  // days === 0 means all-time: use a window large enough to cover every row.
  // The previous-window comparison is then empty by construction, and the
  // frontend hides the delta for all-time.
  const windowDays = days === 0 ? ALL_TIME_WINDOW_DAYS : days;

  const kpiResult = await query<KpiRow>(`
    WITH all_submissions AS (
      SELECT user_id, overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT user_id, overall_status, submitted_at FROM contest_submissions
    )
    SELECT
      COUNT(*) FILTER (WHERE submitted_at >= NOW() - ($1 || ' days')::interval) AS current_submissions,
      COUNT(*) FILTER (WHERE submitted_at >= NOW() - ($2 || ' days')::interval
                         AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_submissions,
      COUNT(DISTINCT user_id) FILTER (WHERE submitted_at >= NOW() - ($1 || ' days')::interval) AS current_submitters,
      COUNT(DISTINCT user_id) FILTER (WHERE submitted_at >= NOW() - ($2 || ' days')::interval
                                        AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_submitters,
      COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}' AND submitted_at >= NOW() - ($1 || ' days')::interval) AS current_accepted,
      COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}' AND submitted_at >= NOW() - ($2 || ' days')::interval
                         AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_accepted
    FROM all_submissions`,
    [windowDays, windowDays * 2]);
  const kpi = firstRow(kpiResult.rows);

  const newUsersResult = await query<NewUsersRow>(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::interval) AS current_users,
      COUNT(*) FILTER (WHERE created_at >= NOW() - ($2 || ' days')::interval
                         AND created_at < NOW() - ($1 || ' days')::interval) AS previous_users
    FROM users`,
    [windowDays, windowDays * 2]);

  const activeProblemsResult = await query<NewUsersRow>(`
    SELECT
      COUNT(DISTINCT problem_id) FILTER (WHERE submitted_at >= NOW() - ($1 || ' days')::interval) AS current_users,
      COUNT(DISTINCT problem_id) FILTER (WHERE submitted_at >= NOW() - ($2 || ' days')::interval
                                           AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_users
    FROM (
      SELECT problem_id, submitted_at FROM submissions
      UNION ALL
      SELECT problem_id, submitted_at FROM contest_submissions
    ) s`,
    [windowDays, windowDays * 2]);

  const dailyResult = await query<DailyRow>(`
    WITH all_submissions AS (
      SELECT overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT overall_status, submitted_at FROM contest_submissions
    )
    SELECT
      to_char(date_trunc('day', submitted_at AT TIME ZONE '${ANALYTICS_TIMEZONE}'), 'YYYY-MM-DD') AS day,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS accepted
    FROM all_submissions
    WHERE submitted_at >= NOW() - ($1 || ' days')::interval
    GROUP BY 1
    ORDER BY 1`,
    [windowDays]);

  const verdictResult = await query<VerdictRow>(`
    WITH all_submissions AS (
      SELECT overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT overall_status, submitted_at FROM contest_submissions
    )
    SELECT overall_status AS verdict, COUNT(*) AS count
    FROM all_submissions
    WHERE submitted_at >= NOW() - ($1 || ' days')::interval
    GROUP BY 1
    ORDER BY count DESC`,
    [windowDays]);

  // ANALYSIS-001: the "top" lists respect the selected time window, like
  // every other overview query (they previously aggregated all time even
  // when a window was selected).
  const topProblemsResult = await query<TopProblemRow>(`
    WITH all_submissions AS (
      SELECT problem_id, overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT problem_id, overall_status, submitted_at FROM contest_submissions
    )
    SELECT
      p.id AS problem_id,
      p.title,
      COUNT(s.problem_id) AS submissions,
      COUNT(*) FILTER (WHERE s.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS accepted
    FROM all_submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.submitted_at >= NOW() - ($1 || ' days')::interval
    GROUP BY p.id, p.title
    ORDER BY submissions DESC
    LIMIT 10`,
    [windowDays]);

  const topSubmittersResult = await query<TopSubmitterRow>(`
    WITH all_submissions AS (
      SELECT user_id, problem_id, overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT user_id, problem_id, overall_status, submitted_at FROM contest_submissions
    )
    SELECT
      u.id AS user_id,
      u.username,
      COUNT(s.problem_id) AS submissions,
      COUNT(DISTINCT s.problem_id) FILTER (WHERE s.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS solved
    FROM all_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE s.submitted_at >= NOW() - ($1 || ' days')::interval
    GROUP BY u.id, u.username
    ORDER BY submissions DESC
    LIMIT 10`,
    [windowDays]);

  const contestStatsResult = await query<ContestStatRow>(`
    SELECT
      c.id AS contest_id,
      c.title,
      c.status,
      (SELECT COUNT(*) FROM contest_submissions cs
       WHERE cs.contest_id = c.id AND cs.submitted_at >= NOW() - ($1 || ' days')::interval) AS submissions,
      (SELECT COUNT(*) FROM contest_scoreboards sb WHERE sb.contest_id = c.id) AS participants,
      (SELECT AVG(sb.total_score) FROM contest_scoreboards sb WHERE sb.contest_id = c.id) AS avg_score
    FROM contests c
    ORDER BY c.start_time DESC
    LIMIT 10`,
    [windowDays]);

  return {
    kpis: {
      submissions: { current: toNum(kpi?.current_submissions), previous: toNum(kpi?.previous_submissions) },
      uniqueSubmitters: { current: toNum(kpi?.current_submitters), previous: toNum(kpi?.previous_submitters) },
      accepted: { current: toNum(kpi?.current_accepted), previous: toNum(kpi?.previous_accepted) },
      newUsers: {
        current: toNum(newUsersResult.rows[0]?.current_users),
        previous: toNum(newUsersResult.rows[0]?.previous_users),
      },
      activeProblems: {
        current: toNum(activeProblemsResult.rows[0]?.current_users),
        previous: toNum(activeProblemsResult.rows[0]?.previous_users),
      },
    },
    dailySeries: dailyResult.rows.map((r) => ({ day: r.day, total: toNum(r.total), accepted: toNum(r.accepted) })),
    verdictBreakdown: verdictResult.rows.map((r) => ({ verdict: r.verdict, count: toNum(r.count) })),
    topProblems: topProblemsResult.rows.map((r) => ({
      problemId: r.problem_id,
      title: r.title,
      submissions: toNum(r.submissions),
      accepted: toNum(r.accepted),
    })),
    topSubmitters: topSubmittersResult.rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      submissions: toNum(r.submissions),
      solved: toNum(r.solved),
    })),
    contestStats: contestStatsResult.rows.map((r) => ({
      contestId: r.contest_id,
      title: r.title,
      status: r.status,
      submissions: toNum(r.submissions),
      participants: toNum(r.participants),
      avgScore: toNum(r.avg_score),
    })),
  };
};

// ---------------------------------------------------------------------------
// Per-user analytics
// ---------------------------------------------------------------------------

export interface UserListRow {
  userId: number;
  username: string;
  role: string;
  submissions: number;
  solved: number;
  acRate: number;
  lastActive: string | null;
}

interface UserListQueryRow {
  user_id: number;
  username: string;
  role: string;
  submissions: string;
  solved: string;
  ac_rate: string;
  last_active: string | null;
}

export interface UserAnalytics {
  user: { id: number; username: string; role: string; createdAt: string };
  kpis: { submissions: number; solved: number; attempted: number; acRate: number; totalScore: number };
  dailySeries: Array<{ day: string; count: number }>;
  hourHistogram: Array<{ hour: number; count: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  languageBreakdown: Array<{ language: string; count: number }>;
  cumulativeSolved: Array<{ day: string; solved: number }>;
  solvedByCategory: Array<{ category: string; solved: number; attempted: number }>;
}

interface UserRow { id: number; username: string; role: string; created_at: string }
interface UserKpiRow { submissions: string; attempted: string; solved: string; ac_rate: string; total_score: string }
interface DayCountRow { day: string; count: string }
interface HourCountRow { hour: string; count: string }
interface VerdictCountRow { verdict: string; count: string }
interface LanguageCountRow { language: string; count: string }
interface CumulativeSolvedRow { day: string; solved: string }
interface CategorySolvedRow { category: string; solved: string; attempted: string }

/** Sortable columns for the users list, mapped to SQL expressions. */
const USER_SORT_COLUMNS: Record<string, string> = {
  username: 'u.username',
  submissions: 'submissions',
  solved: 'solved',
  acRate: 'ac_rate',
  lastActive: 'last_active',
};

export type UserSortKey = keyof typeof USER_SORT_COLUMNS;

/** Users with aggregate stats for the analysis tab user list. */
export const listUsersForAnalytics = async (
  search: string,
  limit: number,
  offset: number,
  sortBy: UserSortKey = 'submissions',
  sortDir: 'asc' | 'desc' = 'desc',
): Promise<UserListRow[]> => {
  const sortExpr = USER_SORT_COLUMNS[sortBy] ?? USER_SORT_COLUMNS.submissions;
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
  const result = await query<UserListQueryRow>(`
    WITH all_submissions AS (
      SELECT user_id, problem_id, overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT user_id, problem_id, overall_status, submitted_at FROM contest_submissions
    )
    SELECT
      u.id AS user_id,
      u.username,
      u.role,
      COUNT(s.user_id) AS submissions,
      COUNT(DISTINCT s.problem_id) FILTER (WHERE s.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS solved,
      COALESCE(
        (COUNT(*) FILTER (WHERE s.overall_status = '${SUBMISSION_STATUS.ACCEPTED}'))::float / NULLIF(COUNT(s.user_id), 0),
        0
      ) AS ac_rate,
      to_char(MAX(s.submitted_at), 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS last_active
    FROM users u
    LEFT JOIN all_submissions s ON s.user_id = u.id
    WHERE u.username ILIKE '%' || $1 || '%'
    GROUP BY u.id, u.username, u.role
    ORDER BY ${sortExpr} ${direction} NULLS LAST, u.username ASC
    LIMIT $2 OFFSET $3`,
    [escapeLikePattern(search), limit, offset]);

  return result.rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    role: r.role,
    submissions: toNum(r.submissions),
    solved: toNum(r.solved),
    acRate: toNum(r.ac_rate),
    lastActive: r.last_active,
  }));
};

/** Full analytics payload for a single user, or null when the user is missing. */
export const getUserAnalytics = async (userId: number): Promise<UserAnalytics | null> => {
  const userResult = await query<UserRow>('SELECT id, username, role, created_at FROM users WHERE id = $1', [userId]);
  const user = firstRow(userResult.rows);
  if (!user) return null;

  const kpiResult = await query<UserKpiRow>(`
    WITH user_submissions AS (
      SELECT problem_id, overall_status, score FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT problem_id, overall_status, score FROM contest_submissions WHERE user_id = $1
    ),
    best_scores AS (
      SELECT problem_id, MAX(score) AS best_score
      FROM user_submissions
      GROUP BY problem_id
    )
    SELECT
      COUNT(*) AS submissions,
      COUNT(DISTINCT problem_id) AS attempted,
      COUNT(DISTINCT problem_id) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS solved,
      COALESCE(
        (COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'))::float / NULLIF(COUNT(*), 0),
        0
      ) AS ac_rate,
      COALESCE((SELECT SUM(best_score) FROM best_scores), 0) AS total_score
    FROM user_submissions`,
    [userId]);

  const dailyResult = await query<DayCountRow>(`
    SELECT to_char(date_trunc('day', submitted_at AT TIME ZONE '${ANALYTICS_TIMEZONE}'), 'YYYY-MM-DD') AS day, COUNT(*) AS count
    FROM (
      SELECT submitted_at FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT submitted_at FROM contest_submissions WHERE user_id = $1
    ) s
    GROUP BY 1
    ORDER BY 1`,
    [userId]);

  const hourResult = await query<HourCountRow>(`
    SELECT EXTRACT(HOUR FROM submitted_at AT TIME ZONE '${ANALYTICS_TIMEZONE}')::int AS hour, COUNT(*) AS count
    FROM (
      SELECT submitted_at FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT submitted_at FROM contest_submissions WHERE user_id = $1
    ) s
    GROUP BY 1
    ORDER BY 1`,
    [userId]);

  const verdictResult = await query<VerdictCountRow>(`
    SELECT overall_status AS verdict, COUNT(*) AS count
    FROM (
      SELECT overall_status FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT overall_status FROM contest_submissions WHERE user_id = $1
    ) s
    GROUP BY 1
    ORDER BY count DESC`,
    [userId]);

  const languageResult = await query<LanguageCountRow>(`
    SELECT language, COUNT(*) AS count
    FROM (
      SELECT language FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT language FROM contest_submissions WHERE user_id = $1
    ) s
    GROUP BY 1
    ORDER BY count DESC`,
    [userId]);

  const cumulativeResult = await query<CumulativeSolvedRow>(`
    WITH user_submissions AS (
      SELECT problem_id, overall_status, submitted_at FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT problem_id, overall_status, submitted_at FROM contest_submissions WHERE user_id = $1
    ),
    first_solves AS (
      SELECT problem_id, MIN(submitted_at) AS first_solved_at
      FROM user_submissions
      WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'
      GROUP BY problem_id
    )
    SELECT
      to_char(date_trunc('day', first_solved_at AT TIME ZONE '${ANALYTICS_TIMEZONE}'), 'YYYY-MM-DD') AS day,
      COUNT(*) AS solved
    FROM first_solves
    GROUP BY 1
    ORDER BY 1`,
    [userId]);

  const categoryResult = await query<CategorySolvedRow>(`
    WITH user_submissions AS (
      SELECT problem_id, overall_status FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT problem_id, overall_status FROM contest_submissions WHERE user_id = $1
    )
    SELECT
      cat.category,
      COUNT(DISTINCT us.problem_id) FILTER (WHERE us.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS solved,
      COUNT(DISTINCT us.problem_id) AS attempted
    FROM user_submissions us
    JOIN problems p ON p.id = us.problem_id
    CROSS JOIN LATERAL unnest(
      CASE WHEN cardinality(p.categories) > 0 THEN p.categories ELSE ARRAY['uncategorized'] END
    ) AS cat(category)
    GROUP BY 1
    ORDER BY solved DESC`,
    [userId]);

  const kpi = firstRow(kpiResult.rows);

  return {
    user: { id: user.id, username: user.username, role: user.role, createdAt: user.created_at },
    kpis: {
      submissions: toNum(kpi?.submissions),
      solved: toNum(kpi?.solved),
      attempted: toNum(kpi?.attempted),
      acRate: toNum(kpi?.ac_rate),
      totalScore: toNum(kpi?.total_score),
    },
    dailySeries: dailyResult.rows.map((r) => ({ day: r.day, count: toNum(r.count) })),
    hourHistogram: hourResult.rows.map((r) => ({ hour: toNum(r.hour), count: toNum(r.count) })),
    verdictBreakdown: verdictResult.rows.map((r) => ({ verdict: r.verdict, count: toNum(r.count) })),
    languageBreakdown: languageResult.rows.map((r) => ({ language: r.language, count: toNum(r.count) })),
    cumulativeSolved: cumulativeResult.rows.map((r) => ({ day: r.day, solved: toNum(r.solved) })),
    solvedByCategory: categoryResult.rows.map((r) => ({
      category: r.category,
      solved: toNum(r.solved),
      attempted: toNum(r.attempted),
    })),
  };
};

// ---------------------------------------------------------------------------
// Per-problem analytics
// ---------------------------------------------------------------------------

export interface ProblemAnalytics {
  problem: { id: string; title: string };
  kpis: { submissions: number; accepted: number; acRate: number; uniqueSubmitters: number };
  dailySeries: Array<{ day: string; total: number; accepted: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  testcasePassRates: Array<{ caseNumber: number; passRate: number }>;
  runtimeBuckets: Array<{ bucket: string; count: number }>;
  memoryBuckets: Array<{ bucket: string; count: number }>;
  firstSolves: Array<{ userId: number; username: string; submittedAt: string }>;
}

interface ProblemRow { id: string; title: string }
interface ProblemKpiRow { submissions: string; accepted: string; ac_rate: string; unique_submitters: string }
interface ProblemDailyRow { day: string; total: string; accepted: string }
interface BucketRow { bucket: string; count: string }
interface FirstSolveRow { user_id: number; username: string; submitted_at: string }
interface TestCasePassRow { case_number: number; total: string; passed: string }

/** Full analytics payload for a single problem, or null when missing. */
export const getProblemAnalytics = async (problemId: string): Promise<ProblemAnalytics | null> => {
  const problemResult = await query<ProblemRow>('SELECT id, title FROM problems WHERE id = $1', [problemId]);
  const problem = firstRow(problemResult.rows);
  if (!problem) return null;

  const kpiResult = await query<ProblemKpiRow>(`
    SELECT
      COUNT(*) AS submissions,
      COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS accepted,
      COALESCE(
        (COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'))::float / NULLIF(COUNT(*), 0),
        0
      ) AS ac_rate,
      COUNT(DISTINCT user_id) AS unique_submitters
    FROM (
      SELECT user_id, overall_status FROM submissions WHERE problem_id = $1
      UNION ALL
      SELECT user_id, overall_status FROM contest_submissions WHERE problem_id = $1
    ) s`,
    [problemId]);

  const dailyResult = await query<ProblemDailyRow>(`
    SELECT
      to_char(date_trunc('day', submitted_at AT TIME ZONE '${ANALYTICS_TIMEZONE}'), 'YYYY-MM-DD') AS day,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS accepted
    FROM (
      SELECT overall_status, submitted_at FROM submissions WHERE problem_id = $1
      UNION ALL
      SELECT overall_status, submitted_at FROM contest_submissions WHERE problem_id = $1
    ) s
    GROUP BY 1
    ORDER BY 1`,
    [problemId]);

  const verdictResult = await query<VerdictCountRow>(`
    SELECT overall_status AS verdict, COUNT(*) AS count
    FROM (
      SELECT overall_status FROM submissions WHERE problem_id = $1
      UNION ALL
      SELECT overall_status FROM contest_submissions WHERE problem_id = $1
    ) s
    GROUP BY 1
    ORDER BY count DESC`,
    [problemId]);

  // results JSONB elements look like { testCase, status, timeMs, memoryKb }
  const testcaseResult = await query<TestCasePassRow>(`
    WITH all_results AS (
      SELECT results FROM submissions WHERE problem_id = $1 AND results IS NOT NULL
      UNION ALL
      SELECT results FROM contest_submissions WHERE problem_id = $1 AND results IS NOT NULL
    ),
    cases AS (
      SELECT (elem->>'testCase')::int AS case_number,
             (elem->>'status') AS status
      FROM all_results r,
           jsonb_array_elements(r.results) AS elem
      -- Elements without a testCase number (e.g. compile-error placeholders)
      -- are not real testcase results; skip them.
      WHERE elem ? 'testCase'
    )
    SELECT
      case_number,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = '${SUBMISSION_STATUS.ACCEPTED}') AS passed
    FROM cases
    GROUP BY case_number
    ORDER BY case_number`,
    [problemId]);

  const runtimeResult = await query<BucketRow>(`
    SELECT
      CASE
        WHEN max_time_ms IS NULL THEN 'unknown'
        WHEN max_time_ms < 100 THEN '0-100ms'
        WHEN max_time_ms < 250 THEN '100-250ms'
        WHEN max_time_ms < 500 THEN '250-500ms'
        WHEN max_time_ms < 1000 THEN '500ms-1s'
        ELSE '>1s'
      END AS bucket,
      COUNT(*) AS count
    FROM (
      SELECT max_time_ms FROM submissions WHERE problem_id = $1
      UNION ALL
      SELECT max_time_ms FROM contest_submissions WHERE problem_id = $1
    ) s
    GROUP BY 1`,
    [problemId]);

  const memoryResult = await query<BucketRow>(`
    SELECT
      CASE
        WHEN max_memory_kb IS NULL THEN 'unknown'
        WHEN max_memory_kb < 51200 THEN '0-50MB'
        WHEN max_memory_kb < 102400 THEN '50-100MB'
        WHEN max_memory_kb < 204800 THEN '100-200MB'
        ELSE '>200MB'
      END AS bucket,
      COUNT(*) AS count
    FROM (
      SELECT max_memory_kb FROM submissions WHERE problem_id = $1
      UNION ALL
      SELECT max_memory_kb FROM contest_submissions WHERE problem_id = $1
    ) s
    GROUP BY 1`,
    [problemId]);

  const firstSolvesResult = await query<FirstSolveRow>(`
    SELECT user_id, username, to_char(submitted_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS submitted_at
    FROM (
      SELECT user_id, MIN(submitted_at) AS submitted_at
      FROM (
        SELECT user_id, submitted_at FROM submissions WHERE problem_id = $1 AND overall_status = '${SUBMISSION_STATUS.ACCEPTED}'
        UNION ALL
        SELECT user_id, submitted_at FROM contest_submissions WHERE problem_id = $1 AND overall_status = '${SUBMISSION_STATUS.ACCEPTED}'
      ) s
      GROUP BY user_id
    ) fs
    JOIN users u ON u.id = fs.user_id
    ORDER BY fs.submitted_at ASC
    LIMIT 10`,
    [problemId]);

  const kpi = firstRow(kpiResult.rows);

  return {
    problem: { id: problem.id, title: problem.title },
    kpis: {
      submissions: toNum(kpi?.submissions),
      accepted: toNum(kpi?.accepted),
      acRate: toNum(kpi?.ac_rate),
      uniqueSubmitters: toNum(kpi?.unique_submitters),
    },
    dailySeries: dailyResult.rows.map((r) => ({ day: r.day, total: toNum(r.total), accepted: toNum(r.accepted) })),
    verdictBreakdown: verdictResult.rows.map((r) => ({ verdict: r.verdict, count: toNum(r.count) })),
    testcasePassRates: testcaseResult.rows.map((r) => ({
      caseNumber: r.case_number,
      passRate: toNum(r.total) === 0 ? 0 : toNum(r.passed) / toNum(r.total),
    })),
    runtimeBuckets: runtimeResult.rows.map((r) => ({ bucket: r.bucket, count: toNum(r.count) })),
    memoryBuckets: memoryResult.rows.map((r) => ({ bucket: r.bucket, count: toNum(r.count) })),
    firstSolves: firstSolvesResult.rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      submittedAt: r.submitted_at,
    })),
  };
};

// ---------------------------------------------------------------------------
// Per-contest analytics
// ---------------------------------------------------------------------------

export interface ContestAnalytics {
  contest: { contestId: number; title: string; status: string; startTime: string; endTime: string };
  kpis: {
    participants: number;   // scoreboard rows (joined the contest)
    submitters: number;     // distinct users with >= 1 submission
    submissions: number;
    accepted: number;
    avgScore: number;
    maxScore: number;       // top total_score
  };
  submissionTimeline: Array<{ bucket: string; count: number }>;  // submissions per hour since start
  problemStats: Array<{ problemId: string; title: string; submissions: number; accepted: number; acRate: number; solvers: number }>;
  scoreboard: Array<{ username: string; totalScore: number; solved: number }>;
}

interface ContestRow {
  contest_id: number;
  title: string;
  status: string;
  start_time: string;
  end_time: string;
}
interface ContestKpiRow {
  participants: string;
  submitters: string;
  submissions: string;
  accepted: string;
  avg_score: string | null;
  max_score: string | null;
}
interface TimelineRow { bucket: string; count: string }
interface ContestProblemRow {
  problem_id: string;
  title: string;
  submissions: string;
  accepted: string;
  ac_rate: string;
  solvers: string;
}
interface ContestScoreboardRow {
  username: string;
  total_score: string;
  solved: string;
}

/** Full analytics payload for a single contest, or null when missing. */
export const getContestAnalytics = async (contestId: number): Promise<ContestAnalytics | null> => {
  const contestResult = await query<ContestRow>(
    `SELECT id AS contest_id, title, status, start_time, end_time FROM contests WHERE id = $1`,
    [contestId]);
  const contest = firstRow(contestResult.rows);
  if (!contest) return null;

  const kpiResult = await query<ContestKpiRow>(`
    SELECT
      (SELECT COUNT(*) FROM contest_scoreboards WHERE contest_id = $1) AS participants,
      COUNT(DISTINCT cs.user_id) AS submitters,
      COUNT(cs.id) AS submissions,
      COUNT(*) FILTER (WHERE cs.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS accepted,
      (SELECT AVG(total_score) FROM contest_scoreboards WHERE contest_id = $1) AS avg_score,
      (SELECT COALESCE(MAX(total_score), 0) FROM contest_scoreboards WHERE contest_id = $1) AS max_score
    FROM contest_submissions cs
    WHERE cs.contest_id = $1`,
    [contestId]);

  const timelineResult = await query<TimelineRow>(`
    SELECT
      'H' || (FLOOR(EXTRACT(EPOCH FROM (submitted_at - c.start_time)) / 3600)::int)::text AS bucket,
      COUNT(*) AS count
    FROM contest_submissions cs
    JOIN contests c ON c.id = cs.contest_id
    WHERE cs.contest_id = $1
    GROUP BY 1
    -- ANALYSIS-004: sort by the numeric hour, not the 'H10' string (which
    -- sorted lexicographically and put H10 before H2).
    ORDER BY MIN(FLOOR(EXTRACT(EPOCH FROM (submitted_at - c.start_time)) / 3600)::int)`,
    [contestId]);

  const problemResult = await query<ContestProblemRow>(`
    SELECT
      cp.problem_id,
      cp.title,
      COUNT(cs.id) AS submissions,
      COUNT(*) FILTER (WHERE cs.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS accepted,
      COALESCE(
        (COUNT(*) FILTER (WHERE cs.overall_status = '${SUBMISSION_STATUS.ACCEPTED}'))::float / NULLIF(COUNT(cs.id), 0),
        0
      ) AS ac_rate,
      COUNT(DISTINCT cs.user_id) FILTER (WHERE cs.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS solvers
    FROM contest_problems cp
    LEFT JOIN contest_submissions cs ON cs.contest_id = cp.contest_id AND cs.problem_id = cp.problem_id
    WHERE cp.contest_id = $1
    GROUP BY cp.problem_id, cp.title
    ORDER BY cp.problem_id`,
    [contestId]);

  const scoreboardResult = await query<ContestScoreboardRow>(`
    SELECT
      u.username,
      sb.total_score,
      COUNT(DISTINCT cs.problem_id) FILTER (WHERE cs.overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS solved
    FROM contest_scoreboards sb
    JOIN users u ON u.id = sb.user_id
    LEFT JOIN contest_submissions cs ON cs.contest_id = sb.contest_id AND cs.user_id = sb.user_id
    WHERE sb.contest_id = $1
    GROUP BY u.username, sb.total_score
    ORDER BY sb.total_score DESC, u.username`,
    [contestId]);

  const kpi = firstRow(kpiResult.rows);

  return {
    contest: {
      contestId: contest.contest_id,
      title: contest.title,
      status: contest.status,
      startTime: contest.start_time,
      endTime: contest.end_time,
    },
    kpis: {
      participants: toNum(kpi?.participants),
      submitters: toNum(kpi?.submitters),
      submissions: toNum(kpi?.submissions),
      accepted: toNum(kpi?.accepted),
      avgScore: toNum(kpi?.avg_score),
      maxScore: toNum(kpi?.max_score),
    },
    submissionTimeline: timelineResult.rows.map((r) => ({ bucket: r.bucket, count: toNum(r.count) })),
    problemStats: problemResult.rows.map((r) => ({
      problemId: r.problem_id,
      title: r.title,
      submissions: toNum(r.submissions),
      accepted: toNum(r.accepted),
      acRate: toNum(r.ac_rate),
      solvers: toNum(r.solvers),
    })),
    scoreboard: scoreboardResult.rows.map((r) => ({
      username: r.username,
      totalScore: toNum(r.total_score),
      solved: toNum(r.solved),
    })),
  };
};

// ---------------------------------------------------------------------------
// Problem list with stats (analysis tab picker)
// ---------------------------------------------------------------------------

export interface ProblemListRow {
  problemId: string;
  title: string;
  categories: readonly string[];
  submissions: number;
  accepted: number;
  acRate: number;
  solvers: number;
}

interface ProblemListQueryRow {
  problem_id: string;
  title: string;
  categories: readonly string[];
  submissions: string;
  accepted: string;
  ac_rate: string;
  solvers: string;
}

/** Sortable columns for the problems list, mapped to SQL expressions. */
const PROBLEM_SORT_COLUMNS: Record<string, string> = {
  title: 'p.title',
  category: 'categories_text',
  submissions: 'submissions',
  accepted: 'accepted',
  acRate: 'ac_rate',
  solvers: 'solvers',
};

export type ProblemSortKey = keyof typeof PROBLEM_SORT_COLUMNS;

/** Problems with aggregate stats for the analysis tab problem list. */
export const listProblemsForAnalytics = async (
  search: string,
  limit: number,
  offset: number,
  sortBy: ProblemSortKey = 'submissions',
  sortDir: 'asc' | 'desc' = 'desc',
): Promise<ProblemListRow[]> => {
  const sortExpr = PROBLEM_SORT_COLUMNS[sortBy] ?? PROBLEM_SORT_COLUMNS.submissions;
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
  const result = await query<ProblemListQueryRow>(`
    WITH all_submissions AS (
      SELECT problem_id, user_id, overall_status FROM submissions
      UNION ALL
      SELECT problem_id, user_id, overall_status FROM contest_submissions
    ),
    per_problem AS (
      SELECT
        problem_id,
        COUNT(*) AS submissions,
        COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS accepted,
        COALESCE(
          (COUNT(*) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'))::float / NULLIF(COUNT(*), 0),
          0
        ) AS ac_rate,
        COUNT(DISTINCT user_id) FILTER (WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}') AS solvers
      FROM all_submissions
      GROUP BY problem_id
    )
    SELECT
      p.id AS problem_id,
      p.title,
      ARRAY(SELECT c FROM unnest(p.categories) c ORDER BY c) AS categories,
      ARRAY_TO_STRING(ARRAY(SELECT c FROM unnest(p.categories) c ORDER BY c), ', ') AS categories_text,
      COALESCE(pp.submissions, 0) AS submissions,
      COALESCE(pp.accepted, 0) AS accepted,
      COALESCE(pp.ac_rate, 0) AS ac_rate,
      COALESCE(pp.solvers, 0) AS solvers
    FROM problems p
    LEFT JOIN per_problem pp ON pp.problem_id = p.id
    WHERE p.title ILIKE '%' || $1 || '%' OR p.id ILIKE '%' || $1 || '%'
    ORDER BY ${sortExpr} ${direction} NULLS LAST, p.id ASC
    LIMIT $2 OFFSET $3`,
    [escapeLikePattern(search), limit, offset]);

  return result.rows.map((r) => ({
    problemId: r.problem_id,
    title: r.title,
    categories: r.categories ?? [],
    submissions: toNum(r.submissions),
    accepted: toNum(r.accepted),
    acRate: toNum(r.ac_rate),
    solvers: toNum(r.solvers),
  }));
};

// ---------------------------------------------------------------------------
// Submission list with filters (analysis tab)
// ---------------------------------------------------------------------------

export interface SubmissionFilters {
  problemId?: string;
  userId?: number;
  verdict?: string;
}

export interface SubmissionListRow {
  id: number;
  source: 'main' | 'contest';
  /** Contest id for contest rows; needed to fetch the code via /submissions/:id. */
  contestId: number | null;
  problemId: string;
  problemTitle: string;
  userId: number;
  username: string;
  verdict: string;
  score: number;
  language: string;
  timeMs: number | null;
  memoryKb: number | null;
  submittedAt: string;
}

interface SubmissionQueryRow {
  id: number;
  source: 'main' | 'contest';
  contest_id: number | null;
  problem_id: string;
  problem_title: string;
  user_id: number | null;
  username: string | null;
  overall_status: string;
  score: number;
  language: string;
  max_time_ms: number | null;
  max_memory_kb: number | null;
  submitted_at: string;
}

/**
 * Submissions across both pools, newest first, filterable by problem, user,
 * and verdict. contest rows resolve the problem title via contest_problems
 * (falling back to the main problems table).
 */
export const listSubmissionsForAnalytics = async (
  filters: SubmissionFilters,
  limit: number,
  offset: number,
): Promise<SubmissionListRow[]> => {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filters.problemId !== undefined && filters.problemId !== '') {
    params.push(filters.problemId);
    conditions.push(`s.problem_id = $${params.length}`);
  }
  if (filters.userId !== undefined) {
    params.push(filters.userId);
    conditions.push(`s.user_id = $${params.length}`);
  }
  if (filters.verdict !== undefined && filters.verdict !== '') {
    params.push(filters.verdict);
    conditions.push(`s.overall_status = $${params.length}`);
  }

  params.push(limit);
  const limitIdx = `$${params.length}`;
  params.push(offset);
  const offsetIdx = `$${params.length}`;

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query<SubmissionQueryRow>(`
    WITH contest_problem_titles AS (
      SELECT problem_id, MAX(title) AS title
      FROM contest_problems
      GROUP BY problem_id
    ),
    all_submissions AS (
      SELECT
        s.id,
        'main' AS source,
        NULL::int AS contest_id,
        s.problem_id,
        p.title AS problem_title,
        s.user_id,
        s.overall_status,
        s.score,
        s.language,
        s.max_time_ms,
        s.max_memory_kb,
        s.submitted_at
      FROM submissions s
      JOIN problems p ON p.id = s.problem_id
      UNION ALL
      SELECT
        cs.id,
        'contest' AS source,
        cs.contest_id,
        cs.problem_id,
        COALESCE(cpt.title, cp.title, cs.problem_id) AS problem_title,
        cs.user_id,
        cs.overall_status,
        cs.score,
        cs.language,
        cs.max_time_ms,
        cs.max_memory_kb,
        cs.submitted_at
      FROM contest_submissions cs
      LEFT JOIN contest_problem_titles cpt ON cpt.problem_id = cs.problem_id
      LEFT JOIN problems cp ON cp.id = cs.problem_id
    )
    SELECT
      s.*,
      u.username
    FROM all_submissions s
    LEFT JOIN users u ON u.id = s.user_id
    ${whereClause}
    ORDER BY s.submitted_at DESC
    LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
    params);

  return result.rows.map((r) => ({
    id: r.id,
    source: r.source,
    contestId: r.contest_id,
    problemId: r.problem_id,
    problemTitle: r.problem_title,
    userId: r.user_id ?? 0,
    username: r.username ?? '—',
    verdict: r.overall_status,
    score: r.score,
    language: r.language,
    timeMs: r.max_time_ms,
    memoryKb: r.max_memory_kb,
    submittedAt: r.submitted_at,
  }));
};

export interface RetentionAnalytics {
  /** Users whose latest submission is older than the idle threshold. */
  idleUsers: Array<{ userId: number; username: string; lastActive: string }>;
  /** Registered users who never submitted anything. */
  neverSubmitted: Array<{ userId: number; username: string; createdAt: string }>;
  /** Currently-active users (submitted within the window) for context. */
  activeUsers: number;
}

interface RetentionQueryRow {
  user_id: number;
  username: string;
  last_active: string | null;
  created_at: string;
}

/**
 * Retention / drop-off analytics: who went idle, who never started.
 * `idleDays` bounds the idle threshold (default 30); activity covers both
 * submission pools.
 */
export const getRetentionAnalytics = async (idleDays: number): Promise<RetentionAnalytics> => {
  const lastActiveResult = await query<RetentionQueryRow>(`
    WITH all_submissions AS (
      SELECT user_id, MAX(submitted_at) AS last_active
      FROM (
        SELECT user_id, submitted_at FROM submissions
        UNION ALL
        SELECT user_id, submitted_at FROM contest_submissions
      ) s
      GROUP BY user_id
    )
    SELECT u.id AS user_id, u.username, a.last_active, u.created_at
    FROM users u
    LEFT JOIN all_submissions a ON a.user_id = u.id
    ORDER BY u.id ASC
  `);

  const idleCutoff = new Date(Date.now() - idleDays * 24 * 60 * 60 * 1000);
  const idleUsers: RetentionAnalytics['idleUsers'] = [];
  const neverSubmitted: RetentionAnalytics['neverSubmitted'] = [];
  let activeUsers = 0;

  for (const row of lastActiveResult.rows) {
    if (row.last_active === null) {
      neverSubmitted.push({
        userId: row.user_id,
        username: row.username,
        createdAt: row.created_at,
      });
      continue;
    }
    if (new Date(row.last_active) < idleCutoff) {
      idleUsers.push({
        userId: row.user_id,
        username: row.username,
        lastActive: row.last_active,
      });
    } else {
      activeUsers += 1;
    }
  }

  // Most-recently-idle first — the most actionable cases for staff.
  idleUsers.sort((a, b) => (a.lastActive < b.lastActive ? 1 : -1));

  return { idleUsers, neverSubmitted, activeUsers };
};
