/**
 * A migration runs its `sql` in one transaction. A step Postgres refuses inside a
 * transaction (CREATE INDEX CONCURRENTLY on a large live table) is written as
 * `concurrentStatements` instead: each statement runs on its own, in order, and the
 * version is recorded after the last one. Such statements must be safe to rerun,
 * because a failure part-way leaves the earlier ones applied.
 */
export type Migration =
  | { version: string; sql: string }
  | { version: string; concurrentStatements: readonly string[] };

export type MigrationDatabase = {
  query: (
    text: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: Array<{ version: string }> }>;
};

const ensureMigrationTableSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`;

const selectAppliedVersionsSql = 'SELECT version FROM schema_migrations ORDER BY version';
const recordAppliedVersionSql = 'INSERT INTO schema_migrations (version) VALUES ($1)';
export const SCHEMA_MIGRATION_LOCK_ID = 734001;

export const runMigrations = async (
  database: MigrationDatabase,
  migrations: readonly Migration[],
): Promise<string[]> => {
  let locked = false;

  try {
    await database.query('SELECT pg_advisory_lock($1)', [SCHEMA_MIGRATION_LOCK_ID]);
    locked = true;
    await database.query(ensureMigrationTableSql);

    const appliedResult = await database.query(selectAppliedVersionsSql);
    const appliedVersions = new Set(appliedResult.rows.map(({ version }) => version));
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      if ('concurrentStatements' in migration) {
        for (const statement of migration.concurrentStatements) {
          await database.query(statement);
        }
        await database.query(recordAppliedVersionSql, [migration.version]);
        newlyApplied.push(migration.version);
        continue;
      }

      await database.query('BEGIN');
      try {
        await database.query(migration.sql);
        await database.query(recordAppliedVersionSql, [migration.version]);
        await database.query('COMMIT');
        newlyApplied.push(migration.version);
      } catch (error) {
        await database.query('ROLLBACK');
        throw error;
      }
    }

    return newlyApplied;
  } finally {
    if (locked) {
      await database.query('SELECT pg_advisory_unlock($1)', [SCHEMA_MIGRATION_LOCK_ID]);
    }
  }
};
