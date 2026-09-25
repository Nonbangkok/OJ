import pg, { PoolClient } from 'pg';
import { env } from './config/env';
import { DATABASE_POOL } from './constants';
const { Pool } = pg;

// When connecting in Docker, Docker Compose injects the DATABASE_URL directly.
const basePoolConfig = {
  connectionString: env.DATABASE_URL,
  // When connecting container-to-container on a private Docker network like in this
  // docker-compose setup, SSL is not necessary as the network is isolated.
  // The official Postgres image doesn't enable SSL by default.
  ssl: false,
};

// DB-10: explicit pool sizing + a session-level statement timeout for every
// API query, so a runaway query can no longer hold a pool slot indefinitely.
// Exported for config-level assertions (tests/db.test.ts).
export const appPoolOptions = {
  ...basePoolConfig,
  max: DATABASE_POOL.MAX_CONNECTIONS,
  // Applied per connection at connect time via the libpq startup `options`
  // parameter (same mechanism as psql's PGOPTIONS).
  options: `-c statement_timeout=${DATABASE_POOL.STATEMENT_TIMEOUT_MS}`,
};

const pool = new Pool(appPoolOptions);

/**
 * DB-10: migrations are exempt from the API statement timeout — index builds
 * and backfills on a large restored dump may legitimately exceed it. The
 * CLI migrate command and the post-import migration step run on a pool built
 * here instead of the shared `pool`. Callers own the returned pool (and must
 * `end()` it).
 */
export const createMigrationsPool = (): pg.Pool => new Pool(basePoolConfig);

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => pool.query<T>(text, params);
export { pool };

/**
 * DB-04: run `body` inside a single transaction on a dedicated pool client.
 * BEGIN/COMMIT/ROLLBACK with the client always released back to the pool;
 * a failed ROLLBACK (broken connection) does not mask the original error.
 */
export const withTransaction = async <T>(body: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; release() will discard it.
    }
    throw error;
  } finally {
    client.release();
  }
};
