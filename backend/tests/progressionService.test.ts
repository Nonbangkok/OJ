import {
    calculateProblemXP,
    getLevelFromXP,
    getXPForLevel,
    getLevelProgress,
    getTierForLevel,
} from '../services/progressionService';

describe('calculateProblemXP', () => {
    it.each([
        [800, 20],
        [1000, 28],
        [1200, 37],
        [1400, 46],
        [1600, 57],
        [1800, 68],
        [2000, 79],
        [2200, 91],
        [3500, 183],
    ])('difficulty %i -> %i XP', (difficulty, expected) => {
        expect(calculateProblemXP(difficulty)).toBe(expected);
    });

    it('uses the unrated fallback for null difficulty', () => {
        expect(calculateProblemXP(null)).toBe(10);
    });

    it('never returns negative or non-finite XP', () => {
        // Even nonsensical difficulty values must not poison progression.
        expect(calculateProblemXP(0)).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(calculateProblemXP(-100))).toBe(true);
        expect(calculateProblemXP(-100)).toBeGreaterThanOrEqual(0);
    });
});

describe('getXPForLevel / getLevelFromXP', () => {
    it.each([
        [1, 0],
        [2, 100],
        [3, 400],
        [4, 900],
        [5, 1600],
        [6, 2500],
        [7, 3600],
    ])('level %i starts at %i XP', (level, xp) => {
        expect(getXPForLevel(level)).toBe(xp);
    });

    it.each([
        [0, 1],
        [99, 1],
        [100, 2],
        [399, 2],
        [400, 3],
        [900, 4],
        [1599, 4],
        [1600, 5],
        [3600, 7],
    ])('%i XP -> level %i', (xp, level) => {
        expect(getLevelFromXP(xp)).toBe(level);
    });
});

describe('getLevelProgress', () => {
    it('computes current/required/remaining/percentage within a level', () => {
        // 1270 XP: level 4 spans 900..1600
        const progress = getLevelProgress(1270);
        expect(progress.currentLevel).toBe(4);
        expect(progress.current).toBe(370);
        expect(progress.required).toBe(700);
        expect(progress.remaining).toBe(330);
        expect(progress.percentage).toBe(53);
    });

    it('reports exact level boundaries as the start of the next level', () => {
        expect(getLevelProgress(0).currentLevel).toBe(1);
        expect(getLevelProgress(100).currentLevel).toBe(2);
        expect(getLevelProgress(100).current).toBe(0);
        expect(getLevelProgress(100).remaining).toBe(300);
    });
});

describe('getTierForLevel', () => {
    it.each([
        [1, 'Novice'],
        [4, 'Novice'],
        [5, 'Apprentice'],
        [9, 'Apprentice'],
        [10, 'Specialist'],
        [14, 'Specialist'],
        [15, 'Expert'],
        [19, 'Expert'],
        [20, 'Master'],
        [29, 'Master'],
        [30, 'Grandmaster'],
        [99, 'Grandmaster'],
    ])('level %i -> %s', (level, tier) => {
        expect(getTierForLevel(level)).toBe(tier);
    });
});
