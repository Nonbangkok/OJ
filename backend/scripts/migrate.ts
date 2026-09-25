import type { Pool } from 'pg';
import { createMigrationsPool } from '../db';
import { migrations as registeredMigrations } from '../migrations';
import {
  Migration,
  MigrationDatabase,
  runMigrations,
} from '../migrations/migrationRunner';
import { getErrorMessage } from '../utils/errorMessage';

export const runMigrationsFromPool = async (
  databasePool: Pick<Pool, 'connect'>,
  migrations: readonly Migration[] = registeredMigrations,
): Promise<string[]> => {
  const client = await databasePool.connect();

  const database: MigrationDatabase = {
    query: async (text, params) => {
      const result = await client.query(text, params === undefined ? undefined : [...params]);
      return { rows: result.rows as Array<{ version: string }> };
    },
  };

  try {
    return await runMigrations(database, migrations);
  } finally {
    client.release();
  }
};

export const migrateAndClose = async (
  databasePool?: Pick<Pool, 'connect' | 'end'>,
  migrations: readonly Migration[] = registeredMigrations,
): Promise<string[]> => {
  // Default to a dedicated pool without the API statement_timeout (DB-10):
  // migration index builds may legitimately run longer than API queries.
  const poolToUse = databasePool ?? createMigrationsPool();
  try {
    return await runMigrationsFromPool(poolToUse, migrations);
  } finally {
    await poolToUse.end();
  }
};

const main = async (): Promise<void> => {
  const applied = await migrateAndClose();
  if (applied.length === 0) {
    console.log('Database schema is already up to date.');
    return;
  }
  console.log(`Applied database migrations: ${applied.join(', ')}`);
};

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`Database migration failed: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
