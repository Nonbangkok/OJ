import type { AchievementStats } from '../types';

/**
 * Frontend mirror of the backend achievement catalog (ids must match
 * `backend/constants/index.ts` ACHIEVEMENTS). The backend sends only the
 * unlocked ids and the stats; this catalog drives rendering of every card,
 * including locked cards with progress.
 */
export interface AchievementCatalogEntry {
  id: string;
  name: string;
  description: string;
  /** Progress toward the threshold for locked cards; null when progress
   *  is not naturally quantifiable (e.g. polyglot's boolean). */
  progressFrom: (stats: AchievementStats) => {
    current: number;
    target: number;
    unit: string;
  } | null;
}

export const ACHIEVEMENT_CATALOG: readonly AchievementCatalogEntry[] = [
  {
    id: 'first_solve',
    name: 'First Solve',
    description: 'Solve your first problem',
    progressFrom: (s) => ({ current: s.problemsSolved, target: 1, unit: 'problem' }),
  },
  {
    id: 'ten_solves',
    name: 'Getting Started',
    description: 'Solve 10 problems',
    progressFrom: (s) => ({ current: s.problemsSolved, target: 10, unit: 'problems' }),
  },
  {
    id: 'fifty_solves',
    name: 'Problem Grinder',
    description: 'Solve 50 problems',
    progressFrom: (s) => ({ current: s.problemsSolved, target: 50, unit: 'problems' }),
  },
  {
    id: 'hundred_solves',
    name: 'Century',
    description: 'Solve 100 problems',
    progressFrom: (s) => ({ current: s.problemsSolved, target: 100, unit: 'problems' }),
  },
  {
    id: 'streak_7',
    name: 'On Fire',
    description: 'Reach a 7-day AC streak',
    progressFrom: (s) => ({ current: s.longestStreak, target: 7, unit: 'days' }),
  },
  {
    id: 'streak_30',
    name: 'Unstoppable',
    description: 'Reach a 30-day AC streak',
    progressFrom: (s) => ({ current: s.longestStreak, target: 30, unit: 'days' }),
  },
  {
    id: 'polyglot',
    name: 'Polyglot',
    description: 'Solve a problem in 2 or more languages',
    progressFrom: (s) => {
      const solvedLanguages = Object.values(s.languagesSolvedIn).filter((count) => count >= 1).length;
      return { current: solvedLanguages, target: 2, unit: 'languages' };
    },
  },
  {
    id: 'contester',
    name: 'Contester',
    description: 'Participate in your first contest',
    progressFrom: (s) => ({ current: s.contestsJoined, target: 1, unit: 'contest' }),
  },
];

/** True when the catalog id is in the unlocked list from the profile. */
export const isUnlocked = (
  achievement: AchievementCatalogEntry,
  unlockedIds: ReadonlySet<string>,
): boolean => unlockedIds.has(achievement.id);

/** 0–1 fraction of the way to the threshold, clamped. */
export const progressFraction = (
  achievement: AchievementCatalogEntry,
  stats: AchievementStats,
): number => {
  const progress = achievement.progressFrom(stats);
  if (!progress || progress.target <= 0) return 0;
  return Math.min(1, Math.max(0, progress.current / progress.target));
};

/** Compact "37/100 problems" label for a locked card. */
export const progressLabel = (
  achievement: AchievementCatalogEntry,
  stats: AchievementStats,
): string | null => {
  const progress = achievement.progressFrom(stats);
  if (!progress) return null;
  return `${progress.current}/${progress.target} ${progress.unit}`;
};
