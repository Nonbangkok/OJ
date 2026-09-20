import {
  createProblemDraftSchema,
  createProblemSchema,
  updateProblemDraftSchema,
  updateProblemSchema,
} from '../../schemas/requestSchemas';
import {
  PROBLEM_DIFFICULTY_MAX,
  PROBLEM_DIFFICULTY_MIN,
  PROBLEM_DIFFICULTY_STEP,
} from '../../constants';

const validProblemBody = {
  id: 'p1',
  title: 'T',
  author: 'A',
  time_limit_ms: 1000,
  memory_limit_mb: 64,
};

const validDraftBody = {
  problemId: 'redgate',
  title: 'Red Gate',
  authorProfileId: null,
  authorAkaName: 'Author',
  authorRealName: 'Example Author',
  language: 'Thai',
  countryCode: 'THA',
  timeLimitMs: 1000,
  memoryLimitMb: 256,
};

describe('problem difficulty schema validation', () => {
  it('accepts every value on the scale', () => {
    for (let difficulty = PROBLEM_DIFFICULTY_MIN; difficulty <= PROBLEM_DIFFICULTY_MAX; difficulty += PROBLEM_DIFFICULTY_STEP) {
      expect(createProblemSchema.safeParse({ ...validProblemBody, difficulty }).success).toBe(true);
      expect(updateProblemSchema.safeParse({ ...validProblemBody, difficulty }).success).toBe(true);
      expect(createProblemDraftSchema.safeParse({ ...validDraftBody, difficulty }).success).toBe(true);
      expect(updateProblemDraftSchema.safeParse({ expectedRevision: 1, difficulty }).success).toBe(true);
    }
  });

  it('accepts null and undefined (Unrated)', () => {
    for (const difficulty of [null, undefined]) {
      expect(createProblemSchema.safeParse({ ...validProblemBody, difficulty }).success).toBe(true);
      expect(updateProblemSchema.safeParse({ ...validProblemBody, difficulty }).success).toBe(true);
      expect(createProblemDraftSchema.safeParse({ ...validDraftBody, difficulty }).success).toBe(true);
      expect(updateProblemDraftSchema.safeParse({ expectedRevision: 1, difficulty }).success).toBe(true);
    }
    // Omitting the field entirely is also fine.
    expect(createProblemSchema.safeParse(validProblemBody).success).toBe(true);
    expect(createProblemDraftSchema.safeParse(validDraftBody).success).toBe(true);
  });

  it.each([
    ['below the minimum', PROBLEM_DIFFICULTY_MIN - PROBLEM_DIFFICULTY_STEP],
    ['above the maximum', PROBLEM_DIFFICULTY_MAX + PROBLEM_DIFFICULTY_STEP],
    ['not a multiple of the step', PROBLEM_DIFFICULTY_MIN + 50],
    ['not an integer', 1200.5],
    ['a string', '1200'],
  ])('rejects difficulty %s', (_label, difficulty) => {
    expect(createProblemSchema.safeParse({ ...validProblemBody, difficulty }).success).toBe(false);
    expect(updateProblemSchema.safeParse({ ...validProblemBody, difficulty }).success).toBe(false);
    expect(createProblemDraftSchema.safeParse({ ...validDraftBody, difficulty }).success).toBe(false);
    expect(updateProblemDraftSchema.safeParse({ expectedRevision: 1, difficulty }).success).toBe(false);
  });
});
