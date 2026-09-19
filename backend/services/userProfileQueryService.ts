import { query } from '../db';
import { PROFILE_ACTIVITY_WINDOW_DAYS, SUBMISSION_QUERY_CONFIG } from '../constants';

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
    const result = await query<UserProfileStatsRow>(`
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
             GROUP BY submitted_at::date
           ) activity),
           '[]'::jsonb
        ) AS daily_activity
      FROM users u
      WHERE u.username = $1
    `, [username, PROFILE_ACTIVITY_WINDOW_DAYS]);

    return result.rows[0] ?? null;
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
