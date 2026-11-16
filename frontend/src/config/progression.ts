/**
 * Mirror of backend/constants/progression.ts XP_PROGRESSION, for the problem
 * editor's difficulty hint only — the server stays the source of truth.
 */
const BASE_DIFFICULTY = 800;
const BASE_XP = 20;
const DIFFICULTY_EXPONENT = 1.5;
const UNRATED_PROBLEM_XP = 10;

/** XP for a first Accepted solve: round(20 * (difficulty / 800) ^ 1.5); unrated = 10. */
export const solveXp = (difficulty: number | null): number => (
  difficulty === null
    ? UNRATED_PROBLEM_XP
    : Math.round(BASE_XP * (difficulty / BASE_DIFFICULTY) ** DIFFICULTY_EXPONENT)
);
