/**
 * XP / Level / Tier progression constants.
 *
 * XP is earned exactly once per (user, problem) on the user's first Accepted
 * submission for that problem. It is completely independent from the Total
 * Score system: score measures judging results, XP measures unique solves.
 */

/**
 * XP awarded for a solved problem, derived from its difficulty:
 *
 *   XP = round(20 * (difficulty / 800) ^ 1.5)
 *
 * 800 -> 20 XP, 1600 -> 57 XP, 2200 -> 91 XP, 3500 -> 182 XP.
 * Unrated (null difficulty) problems use UNRATED_PROBLEM_XP.
 */
export const XP_PROGRESSION = {
    /** Reference difficulty that maps to the base reward. */
    BASE_DIFFICULTY: 800,
    /** XP awarded at the base difficulty. */
    BASE_XP: 20,
    /** Difficulty curve exponent — superlinear so harder problems are worth
     * disproportionately more, but never multiplied by level/rank. */
    DIFFICULTY_EXPONENT: 1.5,
    /** Fallback reward for problems without a difficulty rating. */
    UNRATED_PROBLEM_XP: 10,
} as const;

/**
 * Tier labels derived from Level. First matching band wins; evaluated from
 * the narrowest level upward. Stored as data so the mapping can be retuned
 * without code changes.
 */
export const LEVEL_TIERS: readonly { minLevel: number; tier: string }[] = [
    { minLevel: 30, tier: 'Grandmaster' },
    { minLevel: 20, tier: 'Master' },
    { minLevel: 15, tier: 'Expert' },
    { minLevel: 10, tier: 'Specialist' },
    { minLevel: 5, tier: 'Apprentice' },
    { minLevel: 1, tier: 'Novice' },
];

/**
 * XP required to *start* a level: 100 * (level - 1)^2.
 *
 * Level 1 starts at 0 XP, Level 2 at 100, Level 3 at 400, Level 4 at 900...
 */
export const XP_PER_LEVEL_BASE = 100;
