import {
  formatProblemZipConfigError,
  problemZipConfigSchema,
} from '../../schemas/problemZipConfig';
import {
  PROBLEM_CATEGORIES,
  PROBLEM_DIFFICULTY_MAX,
  PROBLEM_DIFFICULTY_MIN,
  PROBLEM_DIFFICULTY_STEP,
} from '../../constants';

const validConfig = {
  id: 'aplusb',
  title: 'A Plus B',
  author: 'Nonbangkok',
  time_limit_ms: 1000,
  memory_limit_mb: 256,
};

describe('problem ZIP config.json schema', () => {
  describe('backward compatibility', () => {
    it('accepts a legacy config with only the five original fields', () => {
      const result = problemZipConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toBeUndefined();
        expect(result.data.difficulty).toBeUndefined();
        expect(result.data.collection).toBeUndefined();
      }
    });
  });

  describe('categories', () => {
    it('accepts canonical category names and trims + dedupes + sorts them', () => {
      const result = problemZipConfigSchema.safeParse({
        ...validConfig,
        categories: ['Tree', ' Graph ', 'Tree', 'Math'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(['Graph', 'Math', 'Tree']);
      }
    });

    it('preserves field presence: omitted stays undefined', () => {
      const result = problemZipConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect('categories' in result.data).toBe(false);
      }
    });

    it('null and [] mean "explicitly uncategorized", not "omitted"', () => {
      for (const categories of [null, []]) {
        const result = problemZipConfigSchema.safeParse({ ...validConfig, categories });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.categories).toEqual([]);
        }
      }
    });

    it('rejects unknown categories with the offending name and the allowed list', () => {
      const result = problemZipConfigSchema.safeParse({
        ...validConfig,
        categories: ['Graphs', 'trees'],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = formatProblemZipConfigError(result.error);
        expect(message).toContain('Unknown category "Graphs"');
        expect(message).toContain(`Allowed: ${PROBLEM_CATEGORIES.join(', ')}`);
      }
    });

    it('rejects a non-array, non-string categories value', () => {
      const result = problemZipConfigSchema.safeParse({ ...validConfig, categories: 42 });
      expect(result.success).toBe(false);
    });

    it('a bare category string is accepted as a single-element list', () => {
      const result = problemZipConfigSchema.safeParse({
        ...validConfig,
        categories: 'Graph',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(['Graph']);
      }
    });

    it('an empty string means uncategorized', () => {
      const result = problemZipConfigSchema.safeParse({
        ...validConfig,
        categories: '',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual([]);
      }
    });
  });

  describe('difficulty', () => {
    it('accepts every value on the 800–3500 step-100 scale', () => {
      for (let d = PROBLEM_DIFFICULTY_MIN; d <= PROBLEM_DIFFICULTY_MAX; d += PROBLEM_DIFFICULTY_STEP) {
        const result = problemZipConfigSchema.safeParse({ ...validConfig, difficulty: d });
        expect(result.success).toBe(true);
      }
    });

    it('null means Unrated / clear, omission stays omitted', () => {
      const cleared = problemZipConfigSchema.safeParse({ ...validConfig, difficulty: null });
      expect(cleared.success).toBe(true);
      if (cleared.success) {
        expect(cleared.data.difficulty).toBeNull();
      }
      const omitted = problemZipConfigSchema.safeParse(validConfig);
      expect(omitted.success).toBe(true);
      if (omitted.success) {
        expect('difficulty' in omitted.data).toBe(false);
      }
    });

    it.each([
      ['below the minimum', PROBLEM_DIFFICULTY_MIN - PROBLEM_DIFFICULTY_STEP],
      ['above the maximum', PROBLEM_DIFFICULTY_MAX + PROBLEM_DIFFICULTY_STEP],
      ['not a multiple of the step', PROBLEM_DIFFICULTY_MIN + 50],
      ['not an integer', 1200.5],
      ['a string', '1200'],
    ])('rejects difficulty %s', (_label, difficulty) => {
      const result = problemZipConfigSchema.safeParse({ ...validConfig, difficulty });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(formatProblemZipConfigError(result.error)).toContain('difficulty');
      }
    });
  });

  describe('collection', () => {
    it('accepts a collection name and trims surrounding whitespace', () => {
      const result = problemZipConfigSchema.safeParse({
        ...validConfig,
        collection: '  Chapter 1  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.collection).toBe('Chapter 1');
      }
    });

    it('null and empty/whitespace-only strings normalize to null (no collection)', () => {
      for (const collection of [null, '', '   ']) {
        const result = problemZipConfigSchema.safeParse({ ...validConfig, collection });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.collection).toBeNull();
        }
      }
    });

    it('omission stays omitted', () => {
      const result = problemZipConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect('collection' in result.data).toBe(false);
      }
    });

    it('rejects non-strings and names longer than 100 characters', () => {
      expect(problemZipConfigSchema.safeParse({ ...validConfig, collection: 7 }).success).toBe(false);
      expect(
        problemZipConfigSchema.safeParse({ ...validConfig, collection: 'x'.repeat(101) }).success,
      ).toBe(false);
    });
  });

  describe('base fields (unchanged requirements)', () => {
    it.each([
      ['missing id', { ...validConfig, id: '' }],
      ['missing title', { ...validConfig, title: '' }],
      ['missing author', { ...validConfig, author: '' }],
      ['missing time_limit_ms', { ...validConfig, time_limit_ms: undefined }],
      ['missing memory_limit_mb', { ...validConfig, memory_limit_mb: undefined }],
      ['zero time limit', { ...validConfig, time_limit_ms: 0 }],
    ])('rejects %s', (_label, config) => {
      expect(problemZipConfigSchema.safeParse(config).success).toBe(false);
    });
  });

  describe('error formatting', () => {
    it('names the offending field path', () => {
      const result = problemZipConfigSchema.safeParse({
        ...validConfig,
        categories: ['Nope'],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(formatProblemZipConfigError(result.error)).toContain('categories');
      }
    });
  });
});
