import { computeStreaks } from '../../utils/streaks';

/** Fixed "today" so every boundary test is deterministic. */
const TODAY = '2026-09-21';

/** 'YYYY-MM-DD' string `offset` days from TODAY (UTC arithmetic — the walk
 *  itself treats day strings as calendar days, so DST never applies). */
const day = (offset: number): string => {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

describe('computeStreaks', () => {
  it('returns zeros and a null date for empty history', () => {
    expect(computeStreaks([], TODAY)).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      lastAcDate: null,
    });
  });

  it('counts a single AC day today as a current streak of 1', () => {
    expect(computeStreaks([TODAY], TODAY)).toEqual({
      currentStreak: 1,
      longestStreak: 1,
      lastAcDate: TODAY,
    });
  });

  it('counts a single-day history from yesterday as still current', () => {
    // A streak survives until the day fully ends: no AC yet today does not
    // break yesterday's streak.
    expect(computeStreaks([day(-1)], TODAY).currentStreak).toBe(1);
  });

  it('drops the current streak once a full day has been missed', () => {
    const summary = computeStreaks([day(-2)], TODAY);
    expect(summary.currentStreak).toBe(0);
    expect(summary.longestStreak).toBe(1);
    expect(summary.lastAcDate).toBe(day(-2));
  });

  it('extends a run ending yesterday with today\'s AC', () => {
    expect(computeStreaks([day(-2), day(-1), TODAY], TODAY)).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      lastAcDate: TODAY,
    });
  });

  it('does not join runs across gap days', () => {
    // AC three and two days ago, a missed day, then AC again today: the
    // current streak is only today, the longest run is two.
    const summary = computeStreaks([day(-3), day(-2), TODAY], TODAY);
    expect(summary.currentStreak).toBe(1);
    expect(summary.longestStreak).toBe(2);
  });

  it('finds the longest run across multiple islands', () => {
    const days = [day(-9), day(-8), day(-7), day(-5), day(-4), day(-3), day(-1)];
    const summary = computeStreaks(days, TODAY);
    expect(summary.longestStreak).toBe(3);
    // The last island ends yesterday, so it is still current.
    expect(summary.currentStreak).toBe(1);
    expect(summary.lastAcDate).toBe(day(-1));
  });

  it('treats consecutive days across a month boundary as adjacent', () => {
    const summary = computeStreaks(['2026-01-30', '2026-01-31', '2026-02-01'], TODAY);
    expect(summary.longestStreak).toBe(3);
    expect(summary.currentStreak).toBe(0);
  });

  it('treats consecutive days across a year boundary as adjacent', () => {
    expect(computeStreaks(['2025-12-30', '2025-12-31', '2026-01-01'], TODAY).longestStreak).toBe(3);
  });

  it('treats February 28 and March 1 as adjacent in a non-leap year', () => {
    expect(computeStreaks(['2027-02-27', '2027-02-28', '2027-03-01'], TODAY).longestStreak).toBe(3);
  });

  it('handles February 29 in a leap year', () => {
    expect(computeStreaks(['2024-02-28', '2024-02-29', '2024-03-01'], TODAY).longestStreak).toBe(3);
    // And 2024-02-28 → 2024-03-01 without the 29th is NOT consecutive.
    expect(computeStreaks(['2024-02-28', '2024-03-01'], TODAY).longestStreak).toBe(1);
  });

  it('reports the most recent day as the last AC date', () => {
    expect(computeStreaks(['2026-01-05', '2026-03-02', '2026-02-11'], TODAY).lastAcDate).toBe('2026-03-02');
  });

  it('is robust to duplicate and unsorted days', () => {
    const summary = computeStreaks([day(-1), TODAY, day(-1), day(-2), TODAY], TODAY);
    expect(summary).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      lastAcDate: TODAY,
    });
  });

  it('reports zero current streak when days are dated in the future', () => {
    // Clock-skewed rows must never fabricate a current streak.
    const summary = computeStreaks([day(1), day(2)], TODAY);
    expect(summary.currentStreak).toBe(0);
    expect(summary.longestStreak).toBe(2);
    expect(summary.lastAcDate).toBe(day(2));
  });
});
