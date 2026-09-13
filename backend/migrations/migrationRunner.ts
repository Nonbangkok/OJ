export type Migration = {
  version: string;
  sql: string;
};

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
