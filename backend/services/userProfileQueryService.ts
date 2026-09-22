import { query } from '../db';
import { PROFILE_ACTIVITY_WINDOW_DAYS, SUBMISSION_QUERY_CONFIG, SUBMISSION_STATUS, ACHIEVEMENTS, PROBLEM_CATEGORIES} from '../constants';
import { computeStreaks } from '../utils/streaks';

export interface UserProfileStatsRow {
    id: number;
    username: string;
    role: string;
    has_avatar: boolean;
    avatar_updated_at: Date | null;
    created_at: Date;
    problems_attempted: number;
    problems_solved: number;
    total_score: number;
    submission_count: number;
    verdict_counts: Record<string, number>;
    language_counts: Record<string, number>;
    daily_activity: Array<{ day: string; count: number }>;
    current_streak: number;
    longest_streak: number;
    last_ac_date: string | null;
    /** Solved/total counts per category (percentage = solved/total), fixed
     *  axis order, zero-filled. Totals cover the same visible standalone
     *  universe the All Problems page lists. */
    categoryStats: Array<{ category: string; solved: number; total: number; percentage: number }>;
    achievements: {
        unlocked: Array<{ id: string; name: string; description: string }>;
        stats: {
            problemsSolved: number;
            currentStreak: number;
            longestStreak: number;
            languagesSolvedIn: Record<string, number>;
            contestsJoined: number;
        };
    };
}

export interface UserAvatarRow {
    avatar_png: Buffer | null;
    avatar_updated_at: Date | null;
}

/**
 * Aggregates a user's public profile statistics from both the standalone
 * submission pool and the migrated contest submissions.
 */
export const getUserProfileStats = async (
    username: string,
): Promise<UserProfileStatsRow | null> => {
    const result = await query<UserProfileStatsRow & {
        ac_days: string[];
        languages_solved_in: Record<string, number>;
        contests_joined: number;
        today: string;
        category_stats_raw: Record<string, number>;
        category_totals_raw: Record<string, number>;
    }>(`
      WITH user_submissions AS (
        SELECT problem_id, language, overall_status, score, submitted_at
        FROM submissions
        WHERE user_id = (SELECT id FROM users WHERE username = $1)
        UNION ALL
        SELECT problem_id, language, overall_status, score, submitted_at
        FROM contest_submissions
        WHERE user_id = (SELECT id FROM users WHERE username = $1)
      ),
      best_scores AS (
        SELECT problem_id, MAX(score) AS best_score
        FROM user_submissions
        GROUP BY problem_id
      )
      SELECT
        u.id,
        u.username,
        u.role,
        (u.avatar_png IS NOT NULL) AS has_avatar,
        u.avatar_updated_at,
        u.created_at,
        (SELECT COUNT(DISTINCT problem_id) FROM user_submissions) AS problems_attempted,
        (SELECT COUNT(DISTINCT problem_id) FROM best_scores WHERE best_score = ${SUBMISSION_QUERY_CONFIG.FULL_PROBLEM_SCORE}) AS problems_solved,
        COALESCE((SELECT SUM(best_score) FROM best_scores), 0) AS total_score,
        (SELECT COUNT(*) FROM user_submissions) AS submission_count,
        COALESCE(
          (SELECT jsonb_object_agg(overall_status, status_count)
           FROM (
             SELECT overall_status, COUNT(*) AS status_count
             FROM user_submissions
             GROUP BY overall_status
           ) verdicts),
           '{}'::jsonb
        ) AS verdict_counts,
        COALESCE(
          (SELECT jsonb_object_agg(language, language_count)
           FROM (
             SELECT language, COUNT(*) AS language_count
             FROM user_submissions
             GROUP BY language
           ) languages),
           '{}'::jsonb
        ) AS language_counts,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('day', day, 'count', day_count) ORDER BY day)
           FROM (
             SELECT to_char(submitted_at::date, 'YYYY-MM-DD') AS day, COUNT(*) AS day_count
             FROM user_submissions
             WHERE submitted_at >= NOW() - ($2 || ' days')::interval
             GROUP BY 1
           ) activity),
           '[]'::jsonb
        ) AS daily_activity,
        COALESCE(
          (SELECT jsonb_agg(day ORDER BY day)
           FROM (
             SELECT DISTINCT to_char(submitted_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day
             FROM user_submissions
             WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'
           ) ac_days),
           '[]'::jsonb
        ) AS ac_days,
        COALESCE(
          (SELECT jsonb_object_agg(language, ac_count)
           FROM (
             SELECT language, COUNT(*) AS ac_count
             FROM user_submissions
             WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'
             GROUP BY language
           ) ac_languages),
           '{}'::jsonb
        ) AS languages_solved_in,
        COALESCE(
          (SELECT jsonb_object_agg(category, solved_count)
           FROM (
             SELECT cat.category, COUNT(*)::int AS solved_count
             FROM (
               SELECT DISTINCT problem_id
               FROM user_submissions
               WHERE overall_status = '${SUBMISSION_STATUS.ACCEPTED}'
             ) solved
             JOIN problems p ON p.id = solved.problem_id
                AND p.is_visible = true AND p.contest_id IS NULL
             CROSS JOIN LATERAL unnest(
               CASE WHEN cardinality(p.categories) > 0 THEN p.categories ELSE ARRAY['Uncategorized'] END
             ) AS cat(category)
             GROUP BY cat.category
           ) per_category),
           '{}'::jsonb
        ) AS category_stats_raw,
        COALESCE(
          (SELECT jsonb_object_agg(category, total_count)
           FROM (
             SELECT cat.category, COUNT(*)::int AS total_count
             FROM problems p
             CROSS JOIN LATERAL unnest(
               CASE WHEN cardinality(p.categories) > 0 THEN p.categories ELSE ARRAY['Uncategorized'] END
             ) AS cat(category)
             WHERE p.is_visible = true AND p.contest_id IS NULL
             GROUP BY cat.category
           ) totals),
           '{}'::jsonb
        ) AS category_totals_raw,
        (SELECT COUNT(*)::int FROM contest_participants WHERE user_id = u.id) AS contests_joined,
        to_char(NOW() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS today
      FROM users u
      WHERE u.username = $1
    `, [username, PROFILE_ACTIVITY_WINDOW_DAYS]);

    const row = result.rows[0];
    if (!row) return null;

    const { currentStreak, longestStreak, lastAcDate } = computeStreaks(row.ac_days ?? [], row.today);

    const achievementStats = {
        problemsSolved: Number(row.problems_solved),
        currentStreak,
        longestStreak,
        languagesSolvedIn: row.languages_solved_in ?? {},
        contestsJoined: Number(row.contests_joined ?? 0),
    };

    const unlocked = ACHIEVEMENTS
        .filter((achievement) => achievement.check(achievementStats))
        .map(({ id, name, description }) => ({ id, name, description }));

    const {
        ac_days: _acDays,
        languages_solved_in: _languagesSolvedIn,
        contests_joined: _contestsJoined,
        today: _today,
        category_stats_raw: categoryStatsRaw,
        category_totals_raw: categoryTotalsRaw,
        ...stats
    } = row;

    // Fixed axis order: the user-facing radar order first, then any remaining
    // system categories (alphabetically) the order does not mention, and
    // Uncategorized always last. The shape must not reorder when counts
    // change; zero-value categories stay present so every axis renders.
    const solvedByCategory = (categoryStatsRaw ?? {}) as Record<string, number>;
    const totalsByCategory = (categoryTotalsRaw ?? {}) as Record<string, number>;
    const RADAR_CATEGORY_ORDER = [
        'Dynamic Programming',
        'Math',
        'Binary Search',
        'Data Structures',
        'Graph',
        'Greedy',
        '2D-Grid',
        'Tree',
        'Divide and Conquer',
        'Bitmasks',
        'Constructive',
        'Sorting',
        'Implementation',
    ];
    const orderedCategories = [
        ...RADAR_CATEGORY_ORDER,
        ...PROBLEM_CATEGORIES.filter((category) => !RADAR_CATEGORY_ORDER.includes(category as never))
            .sort(),
        'Uncategorized',
    ];
    const categoryStats = orderedCategories.map((category) => {
        const solved = Number(solvedByCategory[category] ?? 0);
        const total = Number(totalsByCategory[category] ?? 0);
        // No problems in the category -> 0, never NaN/Infinity.
        const percentage = total > 0 ? Math.round((solved / total) * 1000) / 10 : 0;
        return { category, solved, total, percentage };
    });

    return {
        ...stats,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        last_ac_date: lastAcDate,
        achievements: { unlocked, stats: achievementStats },
        categoryStats,
    };
};

/**
 * Loads the stored avatar bytes and their version timestamp.
 */
export const getUserAvatar = async (username: string): Promise<UserAvatarRow | null> => {
    const result = await query<UserAvatarRow>(`
      SELECT avatar_png, avatar_updated_at
      FROM users
      WHERE username = $1
    `, [username]);

    return result.rows[0] ?? null;
};

/**
 * Replaces the logged-in user's avatar and bumps its version timestamp.
 */
export const updateUserAvatar = async (
    userId: number,
    avatarPng: Buffer,
): Promise<{ avatar_updated_at: Date }> => {
    const result = await query<{ avatar_updated_at: Date }>(`
      UPDATE users
      SET avatar_png = $2, avatar_updated_at = NOW()
      WHERE id = $1
      RETURNING avatar_updated_at
    `, [userId, avatarPng]);

    return result.rows[0];
};
