import { query } from '../db';
import {
    LEVEL_TIERS,
    XP_PER_LEVEL_BASE,
    XP_PROGRESSION,
} from '../constants/progression';

/**
 * XP / Level / Tier progression service.
 *
 * Reward records in `user_problem_rewards` are the single source of truth for
 * XP. Level, tier and rank are always *derived* — never stored — so they can
 * never disagree with the reward history.
 */

export interface LevelProgress {
    currentLevel: number;
    /** XP earned inside the current level. */
    current: number;
    /** XP the whole level span requires. */
    required: number;
    /** XP still needed to reach the next level. */
    remaining: number;
    /** current / required as a rounded percentage (0–100). */
    percentage: number;
}

export interface UserProgression {
    totalXp: number;
    level: number;
    tier: string;
    levelProgress: {
        current: number;
        required: number;
        remaining: number;
        percentage: number;
    };
    /** Dense global rank by total XP among users with at least one reward.
     * Equal XP -> equal rank; null when the user has no rewards. */
    globalRank: number | null;
}

export interface RecentReward {
    problemId: string;
    problemTitle: string | null;
    xpAwarded: number;
    difficultySnapshot: number | null;
    awardedAt: string;
}

/**
 * XP for solving a problem of the given difficulty, using the single
 * centralized formula. Unrated (null) problems earn the fallback reward.
 */
export const calculateProblemXP = (difficulty: number | null): number => {
    if (difficulty === null || difficulty === undefined) {
        return XP_PROGRESSION.UNRATED_PROBLEM_XP;
    }
    const { BASE_DIFFICULTY, BASE_XP, DIFFICULTY_EXPONENT } = XP_PROGRESSION;
    const raw = BASE_XP * Math.pow(difficulty / BASE_DIFFICULTY, DIFFICULTY_EXPONENT);
    // Negative difficulties make Math.pow NaN — clamp to a finite floor.
    const xp = Number.isFinite(raw) ? Math.round(raw) : 0;
    return Math.max(0, xp);
};

/** XP required to *start* the given level: 100 * (level - 1)^2. */
export const getXPForLevel = (level: number): number =>
    XP_PER_LEVEL_BASE * Math.pow(Math.max(1, level) - 1, 2);

/** The level a user with this much total XP is currently in. */
export const getLevelFromXP = (totalXP: number): number => {
    if (totalXP < 0) return 1;
    // Invert xp = 100 * (L - 1)^2  ->  L = 1 + sqrt(xp / 100), floored.
    const level = 1 + Math.floor(Math.sqrt(totalXP / XP_PER_LEVEL_BASE));
    // Guard against float edge cases landing exactly on a boundary.
    return getXPForLevel(level) > totalXP ? level - 1 : level;
};

/** Human-readable tier label for a level. */
export const getTierForLevel = (level: number): string =>
    LEVEL_TIERS.find(band => level >= band.minLevel)?.tier ?? 'Novice';

/** Progress toward the next level, for display. */
export const getLevelProgress = (totalXP: number): LevelProgress => {
    const currentLevel = getLevelFromXP(totalXP);
    const levelStart = getXPForLevel(currentLevel);
    const nextLevelStart = getXPForLevel(currentLevel + 1);
    const required = nextLevelStart - levelStart;
    const current = totalXP - levelStart;
    const remaining = nextLevelStart - totalXP;
    return {
        currentLevel,
        current,
        required,
        remaining,
        percentage: required > 0 ? Math.round((current / required) * 100) : 100,
    };
};

/**
 * SQL expression computing the XP for a problem's difficulty, mirroring
 * calculateProblemXP. Used by the in-transaction award paths that cannot
 * call awardSolveReward (bulk INSERT..SELECT). `p.difficulty` must be the
 * problems-row difficulty column (aliased `p`).
 */
export const solveRewardXpSql = `CASE WHEN p.difficulty IS NULL THEN ${XP_PROGRESSION.UNRATED_PROBLEM_XP}
       ELSE GREATEST(0, ROUND(${XP_PROGRESSION.BASE_XP} * POWER(p.difficulty::numeric / ${XP_PROGRESSION.BASE_DIFFICULTY}, ${XP_PROGRESSION.DIFFICULTY_EXPONENT}))) END`;

/**
 * Attempt to record the FIRST-solve reward for a user/problem pair.
 *
 * Idempotent and race-safe: the database unique constraint on
 * (user_id, problem_id) means concurrent judge completions (or a rejudge
 * re-landing an Accepted verdict) can never create a second reward. Returns
 * the XP awarded — 0 when a reward already exists.
 *
 * The problem's difficulty is snapshotted at award time; later difficulty
 * edits never retroactively change stored rewards.
 */
export const awardSolveReward = async (
    userId: number,
    problemId: string,
    awardedAt: Date = new Date(),
): Promise<number> => {
    const problemRes = await query<{ difficulty: number | null }>(
        'SELECT difficulty FROM problems WHERE id = $1',
        [problemId],
    );
    if (problemRes.rows.length === 0) return 0;

    const difficulty = problemRes.rows[0].difficulty;
    const xp = calculateProblemXP(difficulty);

    const result = await query<{ xp_awarded: number }>(`
      INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, difficulty_snapshot, awarded_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, problem_id) DO NOTHING
      RETURNING xp_awarded
    `, [userId, problemId, xp, difficulty, awardedAt]);

    return result.rows[0]?.xp_awarded ?? 0;
};

/**
 * Tier label for a user, derived from their total XP. A single SUM query —
 * deliberately cheaper than `getUserProgression` (no rank window function),
 * so auth bootstrap endpoints can call it on login/session hydration without
 * a per-request aggregation cost.
 */
export const getUserTier = async (userId: number): Promise<string> => {
    const { tier } = await getUserTierAndLevel(userId);
    return tier;
};

/**
 * Tier label AND numeric level for a user, same single SUM query. Auth
 * bootstrap responses use both for the compact "Tier · Level N" display
 * in the navbar user dropdown.
 */
export const getUserTierAndLevel = async (
    userId: number,
): Promise<{ tier: string; level: number }> => {
    const totals = await query<{ total_xp: string }>(`
      SELECT COALESCE(SUM(xp_awarded), 0) AS total_xp
      FROM user_problem_rewards
      WHERE user_id = $1
    `, [userId]);
    const totalXp = Number(totals.rows[0]?.total_xp ?? 0);
    const level = getLevelFromXP(totalXp);
    return { tier: getTierForLevel(level), level };
};

/**
 * Total XP + derived level/tier/progress + dense global rank for a user.
 * Returns zeros/level 1 (no rank) for users without rewards.
 */
export const getUserProgression = async (userId: number): Promise<UserProgression> => {
    const totals = await query<{ total_xp: string }>(`
      SELECT COALESCE(SUM(xp_awarded), 0) AS total_xp
      FROM user_problem_rewards
      WHERE user_id = $1
    `, [userId]);
    const totalXp = Number(totals.rows[0]?.total_xp ?? 0);

    // Dense rank: users with equal XP share a rank, the next distinct total
    // gets the next consecutive rank. Only users holding at least one reward
    // are ranked. The filter MUST sit strictly outside the ranked subquery —
    // pushing it into the CTE would make DENSE_RANK() evaluate over the
    // single filtered row (always rank 1).
    const rankRes = await query<{ rank: number }>(`
      SELECT rank FROM (
        SELECT user_id, CAST(DENSE_RANK() OVER (ORDER BY total_xp DESC) AS INT) AS rank
        FROM (
          SELECT user_id, SUM(xp_awarded) AS total_xp
          FROM user_problem_rewards
          GROUP BY user_id
        ) xp_totals
      ) ranked
      WHERE user_id = $1
    `, [userId]);

    const progress = getLevelProgress(totalXp);
    return {
        totalXp,
        level: progress.currentLevel,
        tier: getTierForLevel(progress.currentLevel),
        levelProgress: {
            current: progress.current,
            required: progress.required,
            remaining: progress.remaining,
            percentage: progress.percentage,
        },
        globalRank: rankRes.rows[0]?.rank ?? null,
    };
};

/**
 * The user's most recent rewards, newest first, with the problem title at
 * award time (kept via LEFT JOIN so deleted problems don't hide history).
 */
export const getRecentRewards = async (
    userId: number,
    limit = 10,
): Promise<RecentReward[]> => {
    const result = await query<{
        problem_id: string;
        problem_title: string | null;
        xp_awarded: number;
        difficulty_snapshot: number | null;
        awarded_at: Date;
    }>(`
      SELECT r.problem_id, p.title AS problem_title, r.xp_awarded,
             r.difficulty_snapshot, r.awarded_at
      FROM user_problem_rewards r
      LEFT JOIN problems p ON p.id = r.problem_id
      WHERE r.user_id = $1
      ORDER BY r.awarded_at DESC
      LIMIT $2
    `, [userId, limit]);

    return result.rows.map(row => ({
        problemId: row.problem_id,
        problemTitle: row.problem_title ?? null,
        xpAwarded: row.xp_awarded,
        difficultySnapshot: row.difficulty_snapshot ?? null,
        awardedAt: new Date(row.awarded_at).toISOString(),
    }));
};

/**
 * Backfill reward records from historical submissions (both the standalone
 * pool and contest submissions), one per unique solved (user, problem).
 *
 * Idempotent: existing rewards are left untouched, so rerunning is safe and
 * new reruns only add pairs solved since the last run. Each reward uses the
 * problem's *current* difficulty as the snapshot and the user's first
 * Accepted timestamp as awarded_at.
 *
 * @returns number of newly created rewards.
 */
export const backfillSolveRewards = async (): Promise<number> => {
    const result = await query<{ inserted: number }>(`
      WITH first_solves AS (
        SELECT user_id, problem_id, MIN(submitted_at) AS first_ac_at
        FROM (
          SELECT user_id, problem_id, submitted_at FROM submissions
          WHERE overall_status = 'Accepted' AND user_id IS NOT NULL
          UNION ALL
          SELECT user_id, problem_id, submitted_at FROM contest_submissions
          WHERE overall_status = 'Accepted' AND user_id IS NOT NULL
        ) solves
        GROUP BY user_id, problem_id
      ),
      new_rewards AS (
        INSERT INTO user_problem_rewards (user_id, problem_id, xp_awarded, difficulty_snapshot, awarded_at)
        SELECT fs.user_id, fs.problem_id,
               ${solveRewardXpSql},
               p.difficulty,
               fs.first_ac_at
        FROM first_solves fs
        JOIN problems p ON p.id = fs.problem_id
        ON CONFLICT (user_id, problem_id) DO NOTHING
        RETURNING 1
      )
      SELECT COUNT(*)::int AS inserted FROM new_rewards
    `);

    return result.rows[0]?.inserted ?? 0;
};
