import {
  ACHIEVEMENT_CATALOG,
  isUnlocked,
  progressFraction,
  progressLabel,
  type AchievementCatalogEntry,
} from '../../utils/achievements';
import type { AchievementStats } from '../../types';

const baseStats: AchievementStats = {
  problemsSolved: 0,
  currentStreak: 0,
  longestStreak: 0,
  languagesSolvedIn: {},
  contestsJoined: 0,
};

const byId = (id: string): AchievementCatalogEntry => {
  const entry = ACHIEVEMENT_CATALOG.find((a) => a.id === id);
  if (!entry) throw new Error(`Missing catalog entry: ${id}`);
  return entry;
};

describe('achievement catalog helpers', () => {
  it('mirrors the backend catalog ids', () => {
    expect(ACHIEVEMENT_CATALOG.map((a) => a.id)).toEqual([
      'first_solve',
      'ten_solves',
      'fifty_solves',
      'hundred_solves',
      'streak_7',
      'streak_30',
      'polyglot',
      'contester',
    ]);
  });

  it('has unique ids', () => {
    const ids = ACHIEVEMENT_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('detects unlocks by id set membership', () => {
    const unlocked = new Set(['first_solve']);
    expect(isUnlocked(ACHIEVEMENT_CATALOG[0], unlocked)).toBe(true);
    expect(isUnlocked(ACHIEVEMENT_CATALOG[1], unlocked)).toBe(false);
  });

  it('computes a clamped progress fraction', () => {
    const century = byId('hundred_solves');
    expect(progressFraction(century, { ...baseStats, problemsSolved: 37 })).toBeCloseTo(0.37);
    expect(progressFraction(century, { ...baseStats, problemsSolved: 150 })).toBe(1);
    expect(progressFraction(century, baseStats)).toBe(0);
  });

  it('formats progress labels for locked cards', () => {
    const century = byId('hundred_solves');
    expect(progressLabel(century, { ...baseStats, problemsSolved: 37 })).toBe('37/100 problems');
    const streak = byId('streak_7');
    expect(progressLabel(streak, { ...baseStats, longestStreak: 3 })).toBe('3/7 days');
    const polyglot = byId('polyglot');
    expect(progressLabel(polyglot, { ...baseStats, languagesSolvedIn: { cpp: 4 } })).toBe('1/2 languages');
    const contester = byId('contester');
    expect(progressLabel(contester, baseStats)).toBe('0/1 contest');
  });

  it('counts only languages with at least one AC for polyglot progress', () => {
    const polyglot = byId('polyglot');
    const stats = { ...baseStats, languagesSolvedIn: { cpp: 5, python: 0 } };
    expect(progressLabel(polyglot, stats)).toBe('1/2 languages');
  });
});
