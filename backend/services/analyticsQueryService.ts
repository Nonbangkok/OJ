import { query } from '../db';

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
      COUNT(*) FILTER (WHERE overall_status = 'Accepted' AND submitted_at >= NOW() - ($1 || ' days')::interval) AS current_accepted,
      COUNT(*) FILTER (WHERE overall_status = 'Accepted' AND submitted_at >= NOW() - ($2 || ' days')::interval
                         AND submitted_at < NOW() - ($1 || ' days')::interval) AS previous_accepted
    FROM all_submissions`,
    [days, days * 2]);
  const kpi = firstRow(kpiResult.rows);

  const newUsersResult = await query<NewUsersRow>(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::interval) AS current_users,
      COUNT(*) FILTER (WHERE created_at >= NOW() - ($2 || ' days')::interval
                         AND created_at < NOW() - ($1 || ' days')::interval) AS previous_users
    FROM users`,
    [days, days * 2]);

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
    [days, days * 2]);

  const dailyResult = await query<DailyRow>(`
    WITH all_submissions AS (
      SELECT overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT overall_status, submitted_at FROM contest_submissions
    )
    SELECT
      to_char(date_trunc('day', submitted_at), 'YYYY-MM-DD') AS day,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE overall_status = 'Accepted') AS accepted
    FROM all_submissions
    WHERE submitted_at >= NOW() - ($1 || ' days')::interval
    GROUP BY 1
    ORDER BY 1`,
    [days]);

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
    [days]);

  const topProblemsResult = await query<TopProblemRow>(`
    WITH all_submissions AS (
      SELECT problem_id, overall_status FROM submissions
      UNION ALL
      SELECT problem_id, overall_status FROM contest_submissions
    )
    SELECT
      p.id AS problem_id,
      p.title,
      COUNT(s.problem_id) AS submissions,
      COUNT(*) FILTER (WHERE s.overall_status = 'Accepted') AS accepted
    FROM all_submissions s
    JOIN problems p ON p.id = s.problem_id
    GROUP BY p.id, p.title
    ORDER BY submissions DESC
    LIMIT 10`,
    []);

  const topSubmittersResult = await query<TopSubmitterRow>(`
    WITH all_submissions AS (
      SELECT user_id, problem_id, overall_status FROM submissions
      UNION ALL
      SELECT user_id, problem_id, overall_status FROM contest_submissions
    ),
    best AS (
      SELECT user_id, problem_id, MAX((overall_status = 'Accepted')::int) AS solved
      FROM all_submissions
      GROUP BY user_id, problem_id
    )
    SELECT
      u.id AS user_id,
      u.username,
      COUNT(*) AS submissions,
      COALESCE(SUM(b.solved), 0) AS solved
    FROM all_submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN best b ON b.user_id = s.user_id AND b.problem_id = s.problem_id
    GROUP BY u.id, u.username
    ORDER BY submissions DESC
    LIMIT 10`,
    []);

  const contestStatsResult = await query<ContestStatRow>(`
    SELECT
      c.id AS contest_id,
      c.title,
      c.status,
      COUNT(cs.id) AS submissions,
      COUNT(DISTINCT cs.user_id) AS participants,
      AVG(sb.total_score) AS avg_score
    FROM contests c
    LEFT JOIN contest_submissions cs ON cs.contest_id = c.id
    LEFT JOIN contest_scoreboards sb ON sb.contest_id = c.id
    GROUP BY c.id, c.title, c.status
    ORDER BY c.start_time DESC
    LIMIT 10`,
    []);

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

/** Users with aggregate stats for the analysis tab user list. */
export const listUsersForAnalytics = async (search: string, limit: number, offset: number): Promise<UserListRow[]> => {
  const result = await query<UserListQueryRow>(`
    WITH all_submissions AS (
      SELECT user_id, problem_id, overall_status, submitted_at FROM submissions
      UNION ALL
      SELECT user_id, problem_id, overall_status, submitted_at FROM contest_submissions
    ),
    best AS (
      SELECT user_id, problem_id, MAX((overall_status = 'Accepted')::int) AS solved
      FROM all_submissions
      GROUP BY user_id, problem_id
    )
    SELECT
      u.id AS user_id,
      u.username,
      u.role,
      COUNT(s.user_id) AS submissions,
      COALESCE(SUM(b.solved), 0) AS solved,
      COALESCE(
        (COUNT(*) FILTER (WHERE s.overall_status = 'Accepted'))::float / NULLIF(COUNT(s.user_id), 0),
        0
      ) AS ac_rate,
      to_char(MAX(s.submitted_at), 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS last_active
    FROM users u
    LEFT JOIN all_submissions s ON s.user_id = u.id
    LEFT JOIN best b ON b.user_id = u.id AND b.problem_id = s.problem_id
    WHERE u.username ILIKE '%' || $1 || '%'
    GROUP BY u.id, u.username, u.role
    ORDER BY submissions DESC
    LIMIT $2 OFFSET $3`,
    [search, limit, offset]);

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
    )
    SELECT
      COUNT(*) AS submissions,
      COUNT(DISTINCT problem_id) AS attempted,
      COUNT(DISTINCT problem_id) FILTER (WHERE overall_status = 'Accepted') AS solved,
      COALESCE(
        (COUNT(*) FILTER (WHERE overall_status = 'Accepted'))::float / NULLIF(COUNT(*), 0),
        0
      ) AS ac_rate,
      COALESCE(SUM(score), 0) AS total_score
    FROM user_submissions`,
    [userId]);

  const dailyResult = await query<DayCountRow>(`
    SELECT to_char(date_trunc('day', submitted_at), 'YYYY-MM-DD') AS day, COUNT(*) AS count
    FROM (
      SELECT submitted_at FROM submissions WHERE user_id = $1
      UNION ALL
      SELECT submitted_at FROM contest_submissions WHERE user_id = $1
    ) s
    GROUP BY 1
    ORDER BY 1`,
    [userId]);

  const hourResult = await query<HourCountRow>(`
    SELECT EXTRACT(HOUR FROM submitted_at)::int AS hour, COUNT(*) AS count
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
      WHERE overall_status = 'Accepted'
      GROUP BY problem_id
    )
    SELECT
      to_char(date_trunc('day', first_solved_at), 'YYYY-MM-DD') AS day,
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
      COALESCE(p.category, 'uncategorized') AS category,
      COUNT(DISTINCT us.problem_id) FILTER (WHERE us.overall_status = 'Accepted') AS solved,
      COUNT(DISTINCT us.problem_id) AS attempted
    FROM user_submissions us
    JOIN problems p ON p.id = us.problem_id
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
      COUNT(*) FILTER (WHERE overall_status = 'Accepted') AS accepted,
      COALESCE(
        (COUNT(*) FILTER (WHERE overall_status = 'Accepted'))::float / NULLIF(COUNT(*), 0),
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
      to_char(date_trunc('day', submitted_at), 'YYYY-MM-DD') AS day,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE overall_status = 'Accepted') AS accepted
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
    )
    SELECT
      case_number,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'Accepted') AS passed
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
        SELECT user_id, submitted_at FROM submissions WHERE problem_id = $1 AND overall_status = 'Accepted'
        UNION ALL
        SELECT user_id, submitted_at FROM contest_submissions WHERE problem_id = $1 AND overall_status = 'Accepted'
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
      COUNT(*) FILTER (WHERE cs.overall_status = 'Accepted') AS accepted,
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
    ORDER BY 1`,
    [contestId]);

  const problemResult = await query<ContestProblemRow>(`
    SELECT
      cp.problem_id,
      cp.title,
      COUNT(cs.id) AS submissions,
      COUNT(*) FILTER (WHERE cs.overall_status = 'Accepted') AS accepted,
      COALESCE(
        (COUNT(*) FILTER (WHERE cs.overall_status = 'Accepted'))::float / NULLIF(COUNT(cs.id), 0),
        0
      ) AS ac_rate,
      COUNT(DISTINCT cs.user_id) FILTER (WHERE cs.overall_status = 'Accepted') AS solvers
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
      COUNT(DISTINCT cs.problem_id) FILTER (WHERE cs.overall_status = 'Accepted') AS solved
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
