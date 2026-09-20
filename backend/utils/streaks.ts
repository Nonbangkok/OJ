/**
 * Streak computation over a user's AC-day history.
 *
 * A day counts toward a streak when the user has at least one Accepted
 * verdict that day (the caller supplies the distinct day list; day
 * boundaries are decided by the SQL, pinned to Asia/Bangkok).
 */
export interface StreakSummary {
    currentStreak: number;
    longestStreak: number;
    lastAcDate: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of a 'YYYY-MM-DD' day string, as a whole-day unit. */
const dayStart = (isoDay: string): number => Date.parse(`${isoDay}T00:00:00Z`);

/** Whole calendar-day distance between two day strings (negative → `a` earlier). */
const dayDiff = (a: string, b: string): number =>
    Math.round((dayStart(a) - dayStart(b)) / DAY_MS);

/**
 * Walks the (distinct, any-order) AC-day list and derives the streak
 * summary relative to `today` ('YYYY-MM-DD' in the profile timezone).
 *
 * - `currentStreak`: consecutive days ending today (AC already banked) or
 *   yesterday (a streak survives until the day fully ends).
 * - `longestStreak`: longest run of consecutive days anywhere in history.
 * - `lastAcDate`: the most recent day with an AC.
 */
export const computeStreaks = (
    acDays: readonly string[],
    today: string,
): StreakSummary => {
    const days = Array.from(new Set(acDays)).sort();
    if (days.length === 0) {
        return { currentStreak: 0, longestStreak: 0, lastAcDate: null };
    }

    const lastAcDate = days[days.length - 1];

    let longestStreak = 1;
    let runLength = 1;
    for (let i = 1; i < days.length; i++) {
        runLength = dayDiff(days[i], days[i - 1]) === 1 ? runLength + 1 : 1;
        if (runLength > longestStreak) {
            longestStreak = runLength;
        }
    }

    // The current streak is the run that ends today, or — if today has no
    // AC yet — the run that ended yesterday (still alive until midnight).
    // dayDiff(lastAcDate, today) is 0 for today, -1 for yesterday.
    const distanceFromToday = dayDiff(lastAcDate, today);
    const stillCurrent = distanceFromToday === 0 || distanceFromToday === -1;
    let currentStreak = 0;
    if (stillCurrent) {
        currentStreak = 1;
        for (let i = days.length - 2; i >= 0; i--) {
            if (dayDiff(days[i], days[i + 1]) !== -1) break;
            currentStreak++;
        }
    }

    return { currentStreak, longestStreak, lastAcDate };
};
