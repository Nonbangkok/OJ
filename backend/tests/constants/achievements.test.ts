import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, type AchievementStats } from '../../constants';

const baseStats: AchievementStats = {
  problemsSolved: 0,
  longestStreak: 0,
  currentStreak: 0,
  languagesSolvedIn: {},
  contestsJoined: 0,
};

describe('ACHIEVEMENTS catalog', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes every catalog entry by id', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(ACHIEVEMENT_BY_ID[achievement.id]).toBe(achievement);
    }
  });

  it.each([
    ['first_solve', 1],
    ['ten_solves', 10],
    ['fifty_solves', 50],
    ['hundred_solves', 100],
  ])('%s unlocks at exactly %i problems solved', (id, threshold) => {
    const achievement = ACHIEVEMENT_BY_ID[id];
    expect(achievement.check({ ...baseStats, problemsSolved: threshold - 1 })).toBe(false);
    expect(achievement.check({ ...baseStats, problemsSolved: threshold })).toBe(true);
  });

  it.each([
    ['streak_7', 7],
    ['streak_30', 30],
  ])('%s unlocks at exactly a %i-day streak', (id, threshold) => {
    const achievement = ACHIEVEMENT_BY_ID[id];
    expect(achievement.check({ ...baseStats, longestStreak: threshold - 1 })).toBe(false);
    expect(achievement.check({ ...baseStats, longestStreak: threshold })).toBe(true);
  });

  it('polyglot requires two languages with at least one AC each', () => {
    const polyglot = ACHIEVEMENT_BY_ID.polyglot;
    // One language with many ACs is not enough.
    expect(polyglot.check({ ...baseStats, languagesSolvedIn: { cpp: 40 } })).toBe(false);
    // A language with zero ACs does not count as solved-in.
    expect(polyglot.check({ ...baseStats, languagesSolvedIn: { cpp: 5, python: 0 } })).toBe(false);
    expect(polyglot.check({ ...baseStats, languagesSolvedIn: { cpp: 1, python: 1 } })).toBe(true);
  });

  it('contester unlocks at exactly one joined contest', () => {
    const contester = ACHIEVEMENT_BY_ID.contester;
    expect(contester.check({ ...baseStats, contestsJoined: 0 })).toBe(false);
    expect(contester.check({ ...baseStats, contestsJoined: 1 })).toBe(true);
  });

  it('keeps every check pure over serializable stats', () => {
    // The stats object must stay JSON-serializable — it is derived in the
    // profile query and could be cached/serialized downstream.
    const roundTripped = JSON.parse(JSON.stringify(baseStats)) as AchievementStats;
    for (const achievement of ACHIEVEMENTS) {
      expect(() => achievement.check(roundTripped)).not.toThrow();
    }
  });
});
