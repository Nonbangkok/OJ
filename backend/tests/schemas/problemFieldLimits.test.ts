import { createProblemSchema, updateProblemSchema } from '../../schemas/requestSchemas';
import { problemZipConfigSchema } from '../../schemas/problemZipConfig';

/**
 * The problem request schemas must not accept values the columns cannot hold — problems.id VARCHAR(50), title VARCHAR(255),
 * author VARCHAR(100) (migrations/0001CoreSchema.ts). A value that passes Zod
 * but overflows the column fails the INSERT/UPDATE with Postgres 22001, which
 * the error handler answers as an unexplained 500 instead of a field error.
 */
describe('problem field limits match the column widths', () => {
  const base = { id: 'p1', title: 'Title', author: 'Author', time_limit_ms: 1000, memory_limit_mb: 256 };

  describe.each([
    ['createProblemSchema', createProblemSchema],
    ['updateProblemSchema', updateProblemSchema],
  ] as const)('%s', (_name, schema) => {
    it('accepts values at the column widths', () => {
      expect(schema.safeParse({ ...base, id: 'i'.repeat(50) }).success).toBe(true);
      expect(schema.safeParse({ ...base, title: 't'.repeat(255) }).success).toBe(true);
      expect(schema.safeParse({ ...base, author: 'a'.repeat(100) }).success).toBe(true);
    });

    it('rejects an id longer than problems.id VARCHAR(50)', () => {
      expect(schema.safeParse({ ...base, id: 'i'.repeat(51) }).success).toBe(false);
    });

    it('rejects a title longer than problems.title VARCHAR(255)', () => {
      expect(schema.safeParse({ ...base, title: 't'.repeat(256) }).success).toBe(false);
    });

    it('rejects an author longer than problems.author VARCHAR(100)', () => {
      expect(schema.safeParse({ ...base, author: 'a'.repeat(101) }).success).toBe(false);
    });
  });

  describe('problemZipConfigSchema (batch import)', () => {
    it('rejects a title or author the columns cannot hold, so the import reports a field error', () => {
      expect(problemZipConfigSchema.safeParse({ ...base, title: 't'.repeat(255) }).success).toBe(true);
      expect(problemZipConfigSchema.safeParse({ ...base, author: 'a'.repeat(100) }).success).toBe(true);
      expect(problemZipConfigSchema.safeParse({ ...base, title: 't'.repeat(256) }).success).toBe(false);
      expect(problemZipConfigSchema.safeParse({ ...base, author: 'a'.repeat(101) }).success).toBe(false);
    });
  });
});

describe('partial problem updates', () => {
  it('accepts a collection-only update, which the bulk "Move to collection" sends (A6-04)', () => {
    expect(updateProblemSchema.safeParse({ id: 'p1', collection_id: 3 }).success).toBe(true);
    expect(updateProblemSchema.safeParse({ id: 'p1', collection_id: null }).success).toBe(true);
  });

  it('still rejects an empty author when one is sent', () => {
    expect(updateProblemSchema.safeParse({ id: 'p1', author: '' }).success).toBe(false);
  });
});
