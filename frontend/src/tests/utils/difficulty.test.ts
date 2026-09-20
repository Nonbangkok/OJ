import {
  difficultyBand,
  PROBLEM_DIFFICULTY_MAX,
  PROBLEM_DIFFICULTY_MIN,
  PROBLEM_DIFFICULTY_OPTIONS,
  PROBLEM_DIFFICULTY_STEP,
} from '../../utils/constants';

describe('difficulty display helpers', () => {
  it('declares the Codeforces-like scale', () => {
    expect(PROBLEM_DIFFICULTY_MIN).toBe(800);
    expect(PROBLEM_DIFFICULTY_MAX).toBe(3500);
    expect(PROBLEM_DIFFICULTY_STEP).toBe(100);
  });

  it('lists every selectable difficulty value on the scale', () => {
    expect(PROBLEM_DIFFICULTY_OPTIONS).toEqual([800, 900, 1000, 1100, 1200, 1300, 1400, 1500,
      1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900,
      3000, 3100, 3200, 3300, 3400, 3500]);
  });

  it('maps null difficulty to null (Unrated)', () => {
    expect(difficultyBand(null)).toBeNull();
    expect(difficultyBand(undefined)).toBeNull();
  });

  it.each([
    [800, 1], [1100, 1],
    [1200, 2], [1600, 2],
    [1700, 3], [2100, 3],
    [2200, 4], [2700, 4],
    [2800, 5], [3500, 5],
  ])('maps difficulty %d to band %d', (difficulty, band) => {
    expect(difficultyBand(difficulty)).toBe(band);
  });
});
