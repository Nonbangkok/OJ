import {
  submitSchema,
  registerSchema,
  loginSchema,
  createProblemSchema,
  batchCreateUsersSchema,
} from '../../schemas/requestSchemas';
import { SUBMISSION_VALIDATION, STRING_LIMITS, USER_VALIDATION } from '../../constants';

/**
 * Validation-cap coverage (security item B): every otherwise-unbounded
 * user-supplied string must have a finite `.max()` so a single request can't
 * push megabytes of data into the DB / compiler.
 */
describe('requestSchemas size & validation caps', () => {
  describe('submitSchema.code', () => {
    const base = { problemId: 'p1', language: 'cpp' };

    it('accepts code at the maximum length', () => {
      const code = 'a'.repeat(SUBMISSION_VALIDATION.MAX_CODE_LENGTH);
      expect(submitSchema.safeParse({ ...base, code }).success).toBe(true);
    });

    it('rejects code longer than MAX_CODE_LENGTH', () => {
      const code = 'a'.repeat(SUBMISSION_VALIDATION.MAX_CODE_LENGTH + 1);
      const result = submitSchema.safeParse({ ...base, code });
      expect(result.success).toBe(false);
    });

    it('rejects empty code', () => {
      expect(submitSchema.safeParse({ ...base, code: '' }).success).toBe(false);
    });

    it('accepts an optional contestId but requires the core fields', () => {
      expect(submitSchema.safeParse({ ...base, code: 'int main(){}', contestId: 'c1' }).success).toBe(true);
      expect(submitSchema.safeParse({ language: 'cpp', code: 'x' }).success).toBe(false); // missing problemId
    });
  });

  describe('auth string caps', () => {
    it('rejects an over-long username on register', () => {
      const username = 'u'.repeat(STRING_LIMITS.USERNAME + 1);
      expect(registerSchema.safeParse({ username, password: 'secret123' }).success).toBe(false);
    });

    it('rejects an over-long password on register', () => {
      const password = 'p'.repeat(STRING_LIMITS.PASSWORD + 1);
      expect(registerSchema.safeParse({ username: 'validuser', password }).success).toBe(false);
    });

    it('enforces the minimum username/password lengths', () => {
      const shortUser = 'a'.repeat(USER_VALIDATION.MIN_USERNAME_LENGTH - 1);
      expect(registerSchema.safeParse({ username: shortUser, password: 'secret123' }).success).toBe(false);
      const shortPass = 'a'.repeat(USER_VALIDATION.MIN_PASSWORD_LENGTH - 1);
      expect(registerSchema.safeParse({ username: 'validuser', password: shortPass }).success).toBe(false);
    });

    it('accepts a valid login payload and rejects an over-long username', () => {
      expect(loginSchema.safeParse({ username: 'validuser', password: 'pw' }).success).toBe(true);
      const username = 'u'.repeat(STRING_LIMITS.USERNAME + 1);
      expect(loginSchema.safeParse({ username, password: 'pw' }).success).toBe(false);
    });
  });

  describe('problem & batch caps', () => {
    it('rejects an over-long problem title/author', () => {
      const valid = { id: 'p1', title: 'T', author: 'A', time_limit_ms: 1000, memory_limit_mb: 64 };
      expect(createProblemSchema.safeParse(valid).success).toBe(true);

      const longTitle = { ...valid, title: 'T'.repeat(STRING_LIMITS.TITLE + 1) };
      expect(createProblemSchema.safeParse(longTitle).success).toBe(false);

      const longAuthor = { ...valid, author: 'A'.repeat(STRING_LIMITS.AUTHOR + 1) };
      expect(createProblemSchema.safeParse(longAuthor).success).toBe(false);
    });

    it('caps the batch user prefix length and count', () => {
      const longPrefix = 'x'.repeat(STRING_LIMITS.PREFIX + 1);
      expect(batchCreateUsersSchema.safeParse({ prefix: longPrefix, count: 5 }).success).toBe(false);

      expect(
        batchCreateUsersSchema.safeParse({ prefix: 'team', count: USER_VALIDATION.BATCH_MAX_COUNT + 1 }).success,
      ).toBe(false);

      expect(batchCreateUsersSchema.safeParse({ prefix: 'team', count: 5 }).success).toBe(true);
    });
  });
});
