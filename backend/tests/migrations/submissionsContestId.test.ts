import { migrations } from '../../migrations';

describe('submissions.contest_id migration (A5-04)', () => {
  const migration = migrations.find((m) => m.version === '0029_submissions_contest_id');
  const statements = () => (migration as { concurrentStatements: readonly string[] }).concurrentStatements
    .map((s) => s.replace(/\s+/g, ' ').trim());

  it('is registered last, as separate statements (submissions is the largest table)', () => {
    expect(migration).toBeDefined();
    expect(migrations[migrations.length - 1]).toBe(migration);
    expect('concurrentStatements' in migration!).toBe(true);
  });

  it('adds a nullable column, then the foreign key without a scan under the ALTER lock, then validates it', () => {
    const [addColumn, addForeignKey, validate] = statements();
    expect(addColumn).toBe('ALTER TABLE submissions ADD COLUMN IF NOT EXISTS contest_id INTEGER');
    expect(addForeignKey).toContain('IF NOT EXISTS');
    expect(addForeignKey).toContain(
      'ADD CONSTRAINT submissions_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL NOT VALID',
    );
    expect(validate).toBe('ALTER TABLE submissions VALIDATE CONSTRAINT submissions_contest_id_fkey');
  });

  it('builds the index CONCURRENTLY and drops an INVALID leftover first', () => {
    expect(statements().slice(3)).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS idx_submissions_contest_id',
      'CREATE INDEX CONCURRENTLY idx_submissions_contest_id ON submissions (contest_id) WHERE contest_id IS NOT NULL',
    ]);
  });

  it('never backfills or rewrites existing submissions', () => {
    // Contests finished before this migration keep NULL (documented, no backfill).
    for (const statement of statements()) {
      expect(statement).not.toMatch(/\bUPDATE submissions\b|\bDELETE FROM\b|\bINSERT INTO\b/);
    }
  });
});
