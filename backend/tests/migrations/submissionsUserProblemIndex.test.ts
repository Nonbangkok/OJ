import { migrations } from '../../migrations';

describe('submissions (user, problem, score) index migration', () => {
  it('builds the index CONCURRENTLY so submissions and verdicts keep writing during the deploy', () => {
    const migration = migrations.find((m) => m.version === '0025_submissions_user_problem_index');
    expect(migration).toBeDefined();
    expect('concurrentStatements' in migration!).toBe(true);
    const statements = (migration as { concurrentStatements: readonly string[] }).concurrentStatements
      .map((s) => s.replace(/\s+/g, ' ').trim());
    // A failed concurrent build leaves an INVALID index behind; the rerun drops it first.
    expect(statements).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS idx_submissions_user_problem',
      'CREATE INDEX CONCURRENTLY idx_submissions_user_problem ON submissions (user_id, problem_id, score)',
    ]);
  });
});
