import { query } from '../db';
import { ANALYTICS_TIMEZONE, SUBMISSION_QUERY_CONFIG, SUBMISSION_STATUS } from '../constants';
import { computeStreaks } from '../utils/streaks';
import { calculateProblemXP, getUserProgression } from './progressionService';
import { userSubmissionsCte } from './userProfileQueryService';
import type { CollectionProgress, HomeContinue, HomeProblemRef, HomeSummary } from '../types/service';

const FULL_SCORE = SUBMISSION_QUERY_CONFIG.FULL_PROBLEM_SCORE;
const VISIBLE_STANDALONE = 'p.is_visible = true AND p.contest_id IS NULL';
/** The viewer ($1) has a full-score submission on problem p. */
const SOLVED_BY_VIEWER = `EXISTS (SELECT 1 FROM submissions us WHERE us.user_id = $1 AND us.problem_id = p.id AND us.score = ${FULL_SCORE})`;
const WEEK_DAYS = 7;

interface ProblemRow { id: string; title: string; difficulty: number | null }

const ref = (row: ProblemRow): HomeProblemRef => ({
  id: row.id,
  title: row.title,
  difficulty: row.difficulty,
  xp: calculateProblemXP(row.difficulty),
});

const caseStatusesOf = (results: unknown): string[] =>
  Array.isArray(results)
    ? results.map((r) => (r && typeof r === 'object' && 'status' in r ? String((r as { status: unknown }).status) : ''))
    : [];

/** AC days (any submission table, visible problems) and the 7-day solved strip, in the profile timezone. */
const getActivity = async (userId: number) => {
  const result = await query<{ ac_days: string[]; week: { day: string; solved: number }[]; today: string }>(`
    WITH ${userSubmissionsCte('$1')},
    days AS (
      SELECT to_char(d, 'YYYY-MM-DD') AS day
      FROM generate_series(
        (NOW() AT TIME ZONE '${ANALYTICS_TIMEZONE}')::date - ${WEEK_DAYS - 1},
        (NOW() AT TIME ZONE '${ANALYTICS_TIMEZONE}')::date,
        interval '1 day'
      ) AS d
    ),
    accepted AS (
      SELECT problem_id, to_char((submitted_at AT TIME ZONE '${ANALYTICS_TIMEZONE}')::date, 'YYYY-MM-DD') AS day
      FROM user_submissions
      WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'
    )
    SELECT
      COALESCE((SELECT jsonb_agg(DISTINCT day) FROM accepted), '[]'::jsonb) AS ac_days,
      (SELECT jsonb_agg(jsonb_build_object('day', days.day, 'solved', (
         SELECT COUNT(DISTINCT a.problem_id)::int FROM accepted a WHERE a.day = days.day
       )) ORDER BY days.day) FROM days) AS week,
      to_char(NOW() AT TIME ZONE '${ANALYTICS_TIMEZONE}', 'YYYY-MM-DD') AS today
  `, [userId]);
  return result.rows[0];
};

const getContinue = async (userId: number): Promise<HomeContinue | null> => {
  const result = await query<ProblemRow & {
    best_score: number; attempts: number; last_tried_at: Date; latest_status: string; best_results: unknown;
  }>(`
    WITH mine AS (
      SELECT s.problem_id, MAX(s.score) AS best_score, COUNT(*)::int AS attempts, MAX(s.submitted_at) AS last_tried_at
      FROM submissions s
      JOIN problems p ON p.id = s.problem_id AND ${VISIBLE_STANDALONE}
      WHERE s.user_id = $1
      GROUP BY s.problem_id
    )
    SELECT p.id, p.title, p.difficulty, m.best_score, m.attempts, m.last_tried_at,
      (SELECT s.overall_status FROM submissions s WHERE s.user_id = $1 AND s.problem_id = p.id ORDER BY s.id DESC LIMIT 1) AS latest_status,
      (SELECT s.results FROM submissions s WHERE s.user_id = $1 AND s.problem_id = p.id ORDER BY s.score DESC, s.id DESC LIMIT 1) AS best_results
    FROM mine m
    JOIN problems p ON p.id = m.problem_id
    WHERE m.best_score < ${FULL_SCORE}
    ORDER BY m.last_tried_at DESC, p.id
    LIMIT 1
  `, [userId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...ref(row),
    bestScore: Number(row.best_score),
    attempts: Number(row.attempts),
    lastTriedAt: new Date(row.last_tried_at).toISOString(),
    latestStatus: row.latest_status,
    caseStatuses: caseStatusesOf(row.best_results),
  };
};

/** Every visible standalone problem the viewer has not solved, easiest first. */
const getUnsolved = async (userId: number) => {
  const result = await query<ProblemRow & { collection_id: number | null }>(`
    SELECT p.id, p.title, p.difficulty, p.collection_id
    FROM problems p
    WHERE ${VISIBLE_STANDALONE} AND NOT ${SOLVED_BY_VIEWER}
    ORDER BY p.difficulty ASC NULLS LAST, p.id
  `, [userId]);
  return result.rows;
};

const getCollectionCounts = async (userId: number) => {
  const result = await query<{ id: number; name: string; solved: number; total: number }>(`
    SELECT c.id, c.name,
           COUNT(p.id) FILTER (WHERE ${SOLVED_BY_VIEWER})::int AS solved,
           COUNT(p.id)::int AS total
    FROM collections c
    JOIN problems p ON p.collection_id = c.id AND ${VISIBLE_STANDALONE}
    GROUP BY c.id, c.name
    ORDER BY c.name ASC, c.id ASC
  `, [userId]);
  return result.rows;
};

/**
 * Everything the logged-in Home page needs in one round trip (B1 + §7.1):
 * level, run, the 7-day solved strip, what to continue or start with,
 * collection progress, and the problem that would complete the next level.
 */
export const getHomeSummary = async (userId: number): Promise<HomeSummary> => {
  const [progression, activity, cont, unsolved, collectionCounts] = await Promise.all([
    getUserProgression(userId),
    getActivity(userId),
    getContinue(userId),
    getUnsolved(userId),
    getCollectionCounts(userId),
  ]);

  const { currentStreak } = computeStreaks(activity.ac_days ?? [], activity.today);
  const week = activity.week ?? [];
  const solvedToday = (week[week.length - 1]?.solved ?? 0) > 0;

  const collections: CollectionProgress[] = collectionCounts.map((c) => {
    const next = unsolved.find((p) => p.collection_id === c.id);
    return { id: c.id, name: c.name, solved: c.solved, total: c.total, next: next ? ref(next) : null };
  });

  const remaining = progression.levelProgress.remaining;
  const levelUpProblem = unsolved.find((p) => calculateProblemXP(p.difficulty) >= remaining);

  return {
    progression,
    currentStreak,
    solvedToday,
    week,
    continue: cont,
    startWith: cont ? [] : unsolved.slice(0, 3).map(ref),
    collections,
    levelUp: levelUpProblem ? { remaining, problem: ref(levelUpProblem) } : null,
  };
};
