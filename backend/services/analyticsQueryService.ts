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
    newProblems: OverviewKpi;
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

interface NewProblemsRow {
  current_problems: string;
  previous_problems: string;
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

  const newProblemsResult = await query<NewProblemsRow>(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::interval) AS current_problems,
      COUNT(*) FILTER (WHERE created_at >= NOW() - ($2 || ' days')::interval
                         AND created_at < NOW() - ($1 || ' days')::interval) AS previous_problems
    FROM problems`,
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
      SELECT overall_status FROM submissions
      UNION ALL
      SELECT overall_status FROM contest_submissions
    )
    SELECT overall_status AS verdict, COUNT(*) AS count
    FROM all_submissions
    WHERE submitted_at IS NULL OR submitted_at >= NOW() - ($1 || ' days')::interval
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
      newProblems: {
        current: toNum(newProblemsResult.rows[0]?.current_problems),
        previous: toNum(newProblemsResult.rows[0]?.previous_problems),
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
