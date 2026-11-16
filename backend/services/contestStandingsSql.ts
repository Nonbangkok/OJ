/**
 * Contest standings (B9), shared by the live scoreboard and the finish-time
 * snapshot so the FINAL board can never disagree with what was live.
 *
 * Per participant and problem: the best score, the number of attempts, when
 * that best score was first reached (`best_at`) and the per-case statuses of
 * that submission. A participant's tie-break time is the latest `best_at`
 * over problems they scored on ("ties by earliest last improvement", §7.7);
 * a later submission that does not improve a score never moves it.
 *
 * Produces a `WITH … standings AS (…)` block with columns
 * user_id, total_score, detailed_scores, last_score_improvement_time.
 */
export const contestStandingsCte = (contestIdParam: string): string => `
WITH contest_subs AS (
  SELECT cs.id, cs.user_id, cs.problem_id, cs.score, cs.submitted_at, cs.results
  FROM contest_submissions cs
  WHERE cs.contest_id = ${contestIdParam} AND cs.user_id IS NOT NULL
),
problem_best AS (
  SELECT DISTINCT ON (user_id, problem_id)
    user_id, problem_id, score AS best_score, submitted_at AS best_at,
    CASE WHEN jsonb_typeof(results) = 'array'
      THEN COALESCE((SELECT jsonb_agg(r.value->>'status' ORDER BY r.ord)
                     FROM jsonb_array_elements(results) WITH ORDINALITY AS r(value, ord)), '[]'::jsonb)
      ELSE '[]'::jsonb
    END AS statuses
  FROM contest_subs
  ORDER BY user_id, problem_id, score DESC, submitted_at ASC, id ASC
),
problem_attempts AS (
  SELECT user_id, problem_id, COUNT(*)::int AS attempts
  FROM contest_subs
  GROUP BY user_id, problem_id
),
user_totals AS (
  SELECT pb.user_id,
    SUM(pb.best_score)::int AS total_score,
    jsonb_object_agg(pb.problem_id, jsonb_build_object(
      'score', pb.best_score, 'attempts', pa.attempts, 'best_at', pb.best_at, 'statuses', pb.statuses)) AS detailed_scores,
    MAX(pb.best_at) FILTER (WHERE pb.best_score > 0) AS last_improvement
  FROM problem_best pb
  JOIN problem_attempts pa ON pa.user_id = pb.user_id AND pa.problem_id = pb.problem_id
  GROUP BY pb.user_id
),
standings AS (
  SELECT cp.user_id,
    COALESCE(ut.total_score, 0) AS total_score,
    COALESCE(ut.detailed_scores, '{}'::jsonb) AS detailed_scores,
    COALESCE(ut.last_improvement, cp.joined_at) AS last_score_improvement_time
  FROM contest_participants cp
  LEFT JOIN user_totals ut ON ut.user_id = cp.user_id
  WHERE cp.contest_id = ${contestIdParam}
)`;

/** Competition rank over a standings-shaped relation (ties share a rank: 1, 1, 3). */
export const standingsRankSql = (alias: string): string =>
  `RANK() OVER (ORDER BY ${alias}.total_score DESC, ${alias}.last_score_improvement_time ASC)::int`;
