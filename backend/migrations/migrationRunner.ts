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
  ) => Promise<{ rows: Array<{ version: string; locked?: boolean }> }>;
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
/** Postgres breaks a deadlock by failing one side; two concurrent index builds can deadlock each other. */
const DEADLOCK_DETECTED = '40P01';
const CONCURRENT_ATTEMPTS = 5;
const CONCURRENT_RETRY_MS = 200;
const LOCK_POLL_MS = 100;

/**
 * Takes the migration lock by polling, never by blocking in pg_advisory_lock: a session
 * waiting inside that statement holds an open transaction, and a CREATE INDEX
 * CONCURRENTLY run by the lock holder waits for every open transaction to end, so a
 * blocked waiter and the holder would deadlock. Between polls the waiter holds nothing.
 */
const acquireMigrationLock = async (database: MigrationDatabase): Promise<void> => {
  for (;;) {
    const result = await database.query('SELECT pg_try_advisory_lock($1) AS locked', [SCHEMA_MIGRATION_LOCK_ID]);
    if (result.rows[0]?.locked === true) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
};

const isDeadlock = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === DEADLOCK_DETECTED;

/**
 * Runs the statements in order. A concurrent index build waits on every other open
 * transaction in the database, so two builds at once (parallel test schemas, never one
 * deploy) can deadlock; the loser restarts from the first statement, which must clean
 * up what a failed attempt left behind (DROP INDEX CONCURRENTLY IF EXISTS).
 */
const runConcurrentStatements = async (database: MigrationDatabase, statements: readonly string[]): Promise<void> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      for (const statement of statements) {
        await database.query(statement);
      }
      return;
    } catch (error) {
      if (!isDeadlock(error) || attempt >= CONCURRENT_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, CONCURRENT_RETRY_MS * attempt));
    }
  }
};

export const runMigrations = async (
  database: MigrationDatabase,
  migrations: readonly Migration[],
): Promise<string[]> => {
  let locked = false;

  try {
    await acquireMigrationLock(database);
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
        await runConcurrentStatements(database, migration.concurrentStatements);
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
