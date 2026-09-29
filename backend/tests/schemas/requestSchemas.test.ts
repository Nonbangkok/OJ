import {
  submitSchema,
  registerSchema,
  loginSchema,
  createAdminUserSchema,
  createProblemSchema,
  batchCreateUsersSchema,
  updateAdminUserSchema,
  // These schemas are introduced by the chunked batch upload flow. Keeping
  // their boundaries here makes the API contract independent of its routes.
  chunkedBatchUploadCompleteSchema,
  chunkedBatchUploadInitSchema,
  problemsWithStatsQuerySchema,
} from '../../schemas/requestSchemas';
import { SUBMISSION_VALIDATION, STRING_LIMITS, SUPPORTED_LANGUAGES, USER_VALIDATION } from '../../constants';

/**
 * Validation-cap coverage (security item B): every otherwise-unbounded
 * user-supplied string must have a finite `.max()` so a single request can't
 * push megabytes of data into the DB / compiler.
 */
describe('requestSchemas size & validation caps', () => {
  describe('problemsWithStatsQuerySchema categories', () => {
    it('accepts one or multiple canonical categories and preserves the portable query value', () => {
      expect(problemsWithStatsQuerySchema.parse({ category: 'Math' }).category).toBe('Math');
      expect(problemsWithStatsQuerySchema.parse({ category: 'Math,Graph,Uncategorized' }).category)
        .toBe('Math,Graph,Uncategorized');
    });

    it('rejects unknown, empty, or duplicate categories', () => {
      expect(problemsWithStatsQuerySchema.safeParse({ category: 'Math,Not a category' }).success).toBe(false);
      expect(problemsWithStatsQuerySchema.safeParse({ category: 'Math,,Graph' }).success).toBe(false);
      expect(problemsWithStatsQuerySchema.safeParse({ category: 'Math,Math' }).success).toBe(false);
    });
  });

  describe('chunked batch upload schemas', () => {
    const MIB = 1024 * 1024;
    const CHUNK_BYTES = 25 * MIB;
    const MAX_BYTES = 2 * 1024 * 1024 * 1024;

    it('accepts only a positive file size up to 2 GiB with its exact chunk count', () => {
      expect(chunkedBatchUploadInitSchema.safeParse({
        fileName: 'batch.zip', fileSize: 1, totalChunks: 1,
      }).success).toBe(true);
      expect(chunkedBatchUploadInitSchema.safeParse({
        fileName: 'batch.zip', fileSize: MAX_BYTES, totalChunks: 82,
      }).success).toBe(true);
      expect(chunkedBatchUploadInitSchema.safeParse({
        fileName: 'batch.zip', fileSize: 0, totalChunks: 0,
      }).success).toBe(false);
      expect(chunkedBatchUploadInitSchema.safeParse({
        fileName: 'batch.zip', fileSize: MAX_BYTES + 1, totalChunks: 82,
      }).success).toBe(false);
      expect(chunkedBatchUploadInitSchema.safeParse({
        fileName: 'batch.zip', fileSize: CHUNK_BYTES + 1, totalChunks: 1,
      }).success).toBe(false);
      expect(chunkedBatchUploadInitSchema.safeParse({
        fileName: 'batch.zip', fileSize: CHUNK_BYTES + 1, totalChunks: 2,
      }).success).toBe(true);
    });

    it('requires a non-empty upload id when completing an upload', () => {
      expect(chunkedBatchUploadCompleteSchema.safeParse({ uploadId: '2f793c3f-a1a0-4b12-8f25-a2bd84c56dbd' }).success).toBe(true);
      expect(chunkedBatchUploadCompleteSchema.safeParse({ uploadId: '' }).success).toBe(false);
      expect(chunkedBatchUploadCompleteSchema.safeParse({}).success).toBe(false);
    });
  });

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

  describe('submitSchema.language', () => {
    const base = { problemId: 'p1', code: 'int main(){}' };

    it('accepts every supported language', () => {
      for (const language of SUPPORTED_LANGUAGES) {
        expect(submitSchema.safeParse({ ...base, language }).success).toBe(true);
      }
    });

    it('accepts python', () => {
      expect(submitSchema.safeParse({ ...base, language: 'python', code: 'print(1)' }).success).toBe(true);
    });

    it('rejects unknown languages', () => {
      expect(submitSchema.safeParse({ ...base, language: 'java' }).success).toBe(false);
      expect(submitSchema.safeParse({ ...base, language: 'C++' }).success).toBe(false); // case-sensitive
      expect(submitSchema.safeParse({ ...base, language: '' }).success).toBe(false);
    });

    it('requires the language field', () => {
      expect(submitSchema.safeParse({ problemId: 'p1', code: 'x' }).success).toBe(false);
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

    // AUTH-005: the cap must match users.username VARCHAR(50) — a 51–64 char
    // name passed Zod but 500s on the INSERT.
    it('accepts a username of exactly the VARCHAR(50) limit', () => {
      const username = 'u'.repeat(STRING_LIMITS.USERNAME);
      expect(STRING_LIMITS.USERNAME).toBe(50);
      expect(registerSchema.safeParse({ username, password: 'secret123' }).success).toBe(true);
    });

    it('rejects a username one char past the VARCHAR(50) limit', () => {
      const username = 'u'.repeat(STRING_LIMITS.USERNAME + 1);
      expect(registerSchema.safeParse({ username, password: 'secret123' }).success).toBe(false);
      expect(createAdminUserSchema.safeParse({ username, password: 'secret123', role: 'staff' }).success).toBe(false);
      expect(updateAdminUserSchema.safeParse({ username, role: 'staff' }).success).toBe(false);
    });

  });

  describe('createAdminUserSchema role enum', () => {
    // The endpoint sits behind requireAdmin, so allowing role 'admin' on
    // create (mirroring updateAdminUserSchema) does not widen the
    // authorization surface: an admin could already grant it via update.
    it('accepts user, staff, and admin roles', () => {
      for (const role of ['user', 'staff', 'admin']) {
        expect(createAdminUserSchema.safeParse({ username: 'validuser', password: 'secret123', role }).success).toBe(true);
      }
    });

    it('rejects an unknown role', () => {
      expect(createAdminUserSchema.safeParse({ username: 'validuser', password: 'secret123', role: 'superadmin' }).success).toBe(false);
      expect(createAdminUserSchema.safeParse({ username: 'validuser', password: 'secret123', role: 'Admin' }).success).toBe(false); // case-sensitive
    });

    it('enforces the password minimum on admin create', () => {
      const shortPass = 'a'.repeat(USER_VALIDATION.MIN_PASSWORD_LENGTH - 1);
      expect(createAdminUserSchema.safeParse({ username: 'validuser', password: shortPass, role: 'admin' }).success).toBe(false);
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
