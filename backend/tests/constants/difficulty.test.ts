import {
  difficultyBand,
  PROBLEM_DIFFICULTY_BANDS,
  PROBLEM_DIFFICULTY_MAX,
  PROBLEM_DIFFICULTY_MIN,
  PROBLEM_DIFFICULTY_STEP,
} from '../../constants';

describe('problem difficulty constants', () => {
  it('declares the Codeforces-like scale', () => {
    expect(PROBLEM_DIFFICULTY_MIN).toBe(800);
    expect(PROBLEM_DIFFICULTY_MAX).toBe(3500);
    expect(PROBLEM_DIFFICULTY_STEP).toBe(100);
  });

  it('declares five heat-map band boundaries as data', () => {
    expect(PROBLEM_DIFFICULTY_BANDS).toEqual([
      { max: 1100, band: 1 },
      { max: 1600, band: 2 },
      { max: 2100, band: 3 },
      { max: 2700, band: 4 },
      { max: 3500, band: 5 },
    ]);
  });

  describe('difficultyBand', () => {
    it('maps null difficulty to null', () => {
      expect(difficultyBand(null)).toBeNull();
    });

    it('maps boundary values to the correct band', () => {
      expect(difficultyBand(800)).toBe(1);
      expect(difficultyBand(1100)).toBe(1);
      expect(difficultyBand(1200)).toBe(2);
      expect(difficultyBand(1600)).toBe(2);
      expect(difficultyBand(1700)).toBe(3);
      expect(difficultyBand(2100)).toBe(3);
      expect(difficultyBand(2200)).toBe(4);
      expect(difficultyBand(2700)).toBe(4);
      expect(difficultyBand(2800)).toBe(5);
      expect(difficultyBand(3500)).toBe(5);
    });
  });
});
